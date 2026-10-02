import { Firestore } from '@google-cloud/firestore';
import crypto from 'node:crypto';
import { createOnlineGame } from './store.mjs';
import { repairForeignWarriors } from '../core/state.mjs';
import { calculateNextDueAt } from './scheduling.mjs';
import {
  SOCIAL_LIMITS,
  applyRankedResult,
  conversationIdFor,
  hashProfileToken,
  normalizeAvatarId,
  normalizeProfileHandle,
  normalizeProfileStats,
  parseProfileToken,
  publicSocialProfile,
  safeHashEqual,
  validateChatMessage
} from './profile.mjs';
import {
  GAME_STATUS,
  GAME_MODE,
  GAME_VISIBILITY,
  PLAYER_ROLE,
  canAdminister,
  playerIdFromToken,
  hashAccessToken,
  safeTokenHashEqual,
  validateStart
} from './multiplayer.mjs';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortByIso(items, field = 'created_at') {
  return items.sort((a, b) => String(a?.[field] || '').localeCompare(String(b?.[field] || '')));
}

function compactGameDoc(game) {
  const next = structuredClone(game);
  delete next.orders;
  delete next.jobs;
  delete next.audit_log;
  if (next.state) next.state.journal = [];
  next.audit_journal_cursor = 0;
  return plain(next);
}

function compactCheckpoint(snapshot) {
  const payload = structuredClone(snapshot);
  if (payload?.game) {
    payload.game.audit_log = [];
    if (payload.game.state) payload.game.state.journal = [];
    payload.game.orders = (payload.game.orders || []).filter(item => item.status === 'PENDING');
    payload.game.jobs = (payload.game.jobs || []).filter(item => item.status === 'PENDING');
  }
  return plain(payload);
}

function chunk(items, size = 350) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class FirestoreGameStore {
  constructor({
    projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
    databaseId = process.env.AOB_FIRESTORE_DATABASE || '(default)',
    gameId = 'prototype-1'
  } = {}) {
    this.projectId = projectId;
    this.databaseId = databaseId;
    this.gameId = gameId;

    const options = projectId ? { projectId } : {};
    if (databaseId && databaseId !== '(default)') options.databaseId = databaseId;

    this.db = new Firestore(options);
    this.loadedExistingAtStartup = null;
    this.orderCache = new Map();
    this.jobCache = new Map();
    this.eventMaxSeq = 0;
  }

  gameRef() {
    return this.db.collection('games').doc(this.gameId);
  }

  sessionRef(sessionId) {
    return this.gameRef().collection('sessions').doc(sessionId);
  }

  playersRef() {
    return this.gameRef().collection('players');
  }

  playerRef(playerId) {
    return this.playersRef().doc(String(playerId));
  }

  profilesRef() {
    return this.db.collection('profiles');
  }

  profileRef(profileId) {
    return this.profilesRef().doc(String(profileId));
  }

  profileHandleRef(handle) {
    return this.db.collection('profile_handles').doc(normalizeProfileHandle(handle));
  }

  profileSessionRef(profileId, sessionId) {
    return this.profileRef(profileId).collection('sessions').doc(String(sessionId));
  }

  profileGamesRef(profileId) {
    return this.profileRef(profileId).collection('games');
  }

  profileFriendsRef(profileId) {
    return this.profileRef(profileId).collection('friends');
  }

  profileFriendRef(profileId, friendId) {
    return this.profileFriendsRef(profileId).doc(String(friendId));
  }

  incomingFriendRequestsRef(profileId) {
    return this.profileRef(profileId).collection('friend_requests_in');
  }

  outgoingFriendRequestsRef(profileId) {
    return this.profileRef(profileId).collection('friend_requests_out');
  }

  profileBlockedRef(profileId) {
    return this.profileRef(profileId).collection('blocked');
  }

  profileBlockedUserRef(profileId, otherProfileId) {
    return this.profileBlockedRef(profileId).doc(String(otherProfileId));
  }

  profileConversationsRef(profileId) {
    return this.profileRef(profileId).collection('conversations');
  }

  profileConversationRef(profileId, conversationId) {
    return this.profileConversationsRef(profileId).doc(String(conversationId));
  }

  conversationsRef() {
    return this.db.collection('conversations');
  }

  conversationRef(conversationId) {
    return this.conversationsRef().doc(String(conversationId));
  }

  profileGameInvitesRef(profileId) {
    return this.profileRef(profileId).collection('game_invites');
  }

  profileGameInviteRef(profileId, inviteId) {
    return this.profileGameInvitesRef(profileId).doc(String(inviteId));
  }

  async createProfile(profile, session) {
    const profileRef = this.profileRef(profile.id);
    const handleRef = this.profileHandleRef(profile.handle);
    const sessionRef = this.profileSessionRef(profile.id, session.session_id);

    await this.db.runTransaction(async tx => {
      const [existingProfile, existingHandle] = await Promise.all([
        tx.get(profileRef),
        tx.get(handleRef)
      ]);

      if (existingProfile.exists || existingHandle.exists) {
        throw new Error('profile login already exists');
      }

      tx.set(profileRef, plain(profile), { merge: false });
      tx.set(handleRef, {
        handle: profile.handle,
        profile_id: profile.id,
        created_at: profile.created_at
      }, { merge: false });
      tx.set(sessionRef, {
        session_id: session.session_id,
        token_hash: session.token_hash,
        created_at: session.created_at,
        expires_at: session.expires_at,
        revoked_at: null
      }, { merge: false });
    });

    return profile;
  }

  async getProfile(profileId) {
    if (!profileId) return null;
    const doc = await this.profileRef(profileId).get();
    return doc.exists ? doc.data() : null;
  }

  async getProfileByHandle(handle) {
    const handleDoc = await this.profileHandleRef(handle).get();
    if (!handleDoc.exists) return null;
    return this.getProfile(handleDoc.data()?.profile_id);
  }

  async areProfilesFriends(profileId, otherProfileId) {
    if (!profileId || !otherProfileId || profileId === otherProfileId) return false;
    const doc = await this.profileFriendRef(profileId, otherProfileId).get();
    return doc.exists;
  }

  async isBlockedBetween(profileId, otherProfileId) {
    const [a, b] = await Promise.all([
      this.profileBlockedUserRef(profileId, otherProfileId).get(),
      this.profileBlockedUserRef(otherProfileId, profileId).get()
    ]);
    return a.exists || b.exists;
  }

  async sendFriendRequest(fromProfileId, toProfileId, nowMs = Date.now()) {
    if (!fromProfileId || !toProfileId || fromProfileId === toProfileId) {
      throw new Error('cannot add this profile as friend');
    }

    const fromProfileRef = this.profileRef(fromProfileId);
    const toProfileRef = this.profileRef(toProfileId);
    const fromFriendRef = this.profileFriendRef(fromProfileId, toProfileId);
    const toFriendRef = this.profileFriendRef(toProfileId, fromProfileId);
    const outgoingRef = this.outgoingFriendRequestsRef(fromProfileId).doc(toProfileId);
    const incomingRef = this.incomingFriendRequestsRef(toProfileId).doc(fromProfileId);
    const reverseOutgoingRef = this.outgoingFriendRequestsRef(toProfileId).doc(fromProfileId);
    const reverseIncomingRef = this.incomingFriendRequestsRef(fromProfileId).doc(toProfileId);
    const fromBlockRef = this.profileBlockedUserRef(fromProfileId, toProfileId);
    const toBlockRef = this.profileBlockedUserRef(toProfileId, fromProfileId);
    const createdAt = new Date(nowMs).toISOString();

    return this.db.runTransaction(async tx => {
      const [
        fromProfileDoc, toProfileDoc, friendDoc, reverseFriendDoc,
        outgoingDoc, reverseOutgoingDoc, fromBlockDoc, toBlockDoc
      ] = await Promise.all([
        tx.get(fromProfileRef),
        tx.get(toProfileRef),
        tx.get(fromFriendRef),
        tx.get(toFriendRef),
        tx.get(outgoingRef),
        tx.get(reverseOutgoingRef),
        tx.get(fromBlockRef),
        tx.get(toBlockRef)
      ]);

      if (!fromProfileDoc.exists || !toProfileDoc.exists) throw new Error('profile not found');
      if (fromBlockDoc.exists || toBlockDoc.exists) throw new Error('friend request blocked');
      if (friendDoc.exists || reverseFriendDoc.exists) throw new Error('players are already friends');
      if (outgoingDoc.exists) throw new Error('friend request already sent');

      if (reverseOutgoingDoc.exists) {
        tx.delete(reverseOutgoingRef);
        tx.delete(reverseIncomingRef);
        tx.set(fromFriendRef, {
          profile_id: toProfileId,
          friends_since: createdAt
        }, { merge: false });
        tx.set(toFriendRef, {
          profile_id: fromProfileId,
          friends_since: createdAt
        }, { merge: false });
        return { accepted: true, auto_accepted: true };
      }

      const request = {
        from_profile_id: fromProfileId,
        to_profile_id: toProfileId,
        created_at: createdAt
      };
      tx.set(outgoingRef, request, { merge: false });
      tx.set(incomingRef, request, { merge: false });
      return { accepted: false, auto_accepted: false };
    });
  }

  async respondFriendRequest(profileId, fromProfileId, { accept }, nowMs = Date.now()) {
    const incomingRef = this.incomingFriendRequestsRef(profileId).doc(fromProfileId);
    const outgoingRef = this.outgoingFriendRequestsRef(fromProfileId).doc(profileId);
    const myFriendRef = this.profileFriendRef(profileId, fromProfileId);
    const theirFriendRef = this.profileFriendRef(fromProfileId, profileId);
    const myBlockRef = this.profileBlockedUserRef(profileId, fromProfileId);
    const theirBlockRef = this.profileBlockedUserRef(fromProfileId, profileId);
    const nowIso = new Date(nowMs).toISOString();

    return this.db.runTransaction(async tx => {
      const [incoming, myBlock, theirBlock] = await Promise.all([
        tx.get(incomingRef),
        tx.get(myBlockRef),
        tx.get(theirBlockRef)
      ]);
      if (!incoming.exists) throw new Error('friend request not found');
      if (accept && (myBlock.exists || theirBlock.exists)) throw new Error('friend request blocked');

      tx.delete(incomingRef);
      tx.delete(outgoingRef);

      if (accept) {
        tx.set(myFriendRef, {
          profile_id: fromProfileId,
          friends_since: nowIso
        }, { merge: false });
        tx.set(theirFriendRef, {
          profile_id: profileId,
          friends_since: nowIso
        }, { merge: false });
      }

      return { accepted: Boolean(accept) };
    });
  }

  async removeFriend(profileId, friendProfileId) {
    const batch = this.db.batch();
    batch.delete(this.profileFriendRef(profileId, friendProfileId));
    batch.delete(this.profileFriendRef(friendProfileId, profileId));
    await batch.commit();
    return true;
  }

  async blockProfile(profileId, otherProfileId, nowMs = Date.now()) {
    if (!profileId || !otherProfileId || profileId === otherProfileId) {
      throw new Error('cannot block this profile');
    }

    const batch = this.db.batch();
    batch.set(this.profileBlockedUserRef(profileId, otherProfileId), {
      profile_id: otherProfileId,
      blocked_at: new Date(nowMs).toISOString()
    }, { merge: false });
    batch.delete(this.profileFriendRef(profileId, otherProfileId));
    batch.delete(this.profileFriendRef(otherProfileId, profileId));
    batch.delete(this.incomingFriendRequestsRef(profileId).doc(otherProfileId));
    batch.delete(this.outgoingFriendRequestsRef(profileId).doc(otherProfileId));
    batch.delete(this.incomingFriendRequestsRef(otherProfileId).doc(profileId));
    batch.delete(this.outgoingFriendRequestsRef(otherProfileId).doc(profileId));
    await batch.commit();
    return true;
  }

  async unblockProfile(profileId, otherProfileId) {
    await this.profileBlockedUserRef(profileId, otherProfileId).delete();
    return true;
  }

  async listSocialState(profileId) {
    const [friendsSnap, incomingSnap, outgoingSnap, conversationsSnap, invitesSnap, blockedSnap] =
      await Promise.all([
        this.profileFriendsRef(profileId).get(),
        this.incomingFriendRequestsRef(profileId).get(),
        this.outgoingFriendRequestsRef(profileId).get(),
        this.profileConversationsRef(profileId).get(),
        this.profileGameInvitesRef(profileId).get(),
        this.profileBlockedRef(profileId).get()
      ]);

    const profileIds = new Set();
    for (const doc of friendsSnap.docs) profileIds.add(doc.id);
    for (const doc of incomingSnap.docs) profileIds.add(doc.data()?.from_profile_id || doc.id);
    for (const doc of outgoingSnap.docs) profileIds.add(doc.data()?.to_profile_id || doc.id);
    for (const doc of conversationsSnap.docs) profileIds.add(doc.data()?.other_profile_id);
    for (const doc of invitesSnap.docs) profileIds.add(doc.data()?.from_profile_id);
    for (const doc of blockedSnap.docs) profileIds.add(doc.id);

    const profileMap = new Map();
    await Promise.all(
      [...profileIds].filter(Boolean).map(async id => {
        const profile = await this.getProfile(id);
        if (!profile) return;
        const presence = await this.profilePresence(profile);
        profileMap.set(id, {
          ...publicSocialProfile(profile),
          presence
        });
      })
    );

    const visibleSocialProfile = (id, canSeeGameDetails = false) => {
      const base = profileMap.get(id) || { id };
      const presence = structuredClone(base.presence || {
        status: 'OFFLINE',
        online: false,
        in_game: false,
        game: null
      });

      if (
        presence.game &&
        presence.game.visibility === GAME_VISIBILITY.PRIVATE &&
        !canSeeGameDetails
      ) {
        presence.game = {
          game_id: null,
          room_name: null,
          visibility: presence.game.visibility,
          game_mode: presence.game.game_mode,
          status: presence.game.status
        };
      }

      return { ...base, presence };
    };

    const friends = friendsSnap.docs
      .map(doc => ({
        ...visibleSocialProfile(doc.id, true),
        friends_since: doc.data()?.friends_since || null
      }))
      .sort((a, b) => String(a.display_name || a.handle || '').localeCompare(String(b.display_name || b.handle || ''), 'ru'));

    const incoming = incomingSnap.docs.map(doc => {
      const fromId = doc.data()?.from_profile_id || doc.id;
      return {
        ...visibleSocialProfile(fromId, false),
        created_at: doc.data()?.created_at || null
      };
    });

    const outgoing = outgoingSnap.docs.map(doc => {
      const toId = doc.data()?.to_profile_id || doc.id;
      return {
        ...visibleSocialProfile(toId, false),
        created_at: doc.data()?.created_at || null
      };
    });

    const conversations = conversationsSnap.docs
      .map(doc => {
        const data = doc.data() || {};
        const other = visibleSocialProfile(data.other_profile_id, true);
        return {
          conversation_id: doc.id,
          other,
          unread_count: Number(data.unread_count || 0),
          updated_at: data.updated_at || null,
          last_message_preview: data.last_message_preview || ''
        };
      })
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

    const nowMs = Date.now();
    const invites = [];
    for (const doc of invitesSnap.docs) {
      const data = doc.data() || {};
      if (data.status !== 'PENDING') continue;
      if (data.expires_at && Date.parse(data.expires_at) <= nowMs) continue;
      const gameDoc = data.game_id
        ? await this.db.collection('games').doc(data.game_id).get()
        : null;
      invites.push({
        invite_id: doc.id,
        ...data,
        from_profile: visibleSocialProfile(data.from_profile_id, true),
        game: gameDoc?.exists ? {
          game_id: gameDoc.id,
          lifecycle: gameDoc.data()?.lifecycle || null
        } : null
      });
    }

    const blocked = blockedSnap.docs.map(doc => ({
      ...visibleSocialProfile(doc.id, false),
      blocked_at: doc.data()?.blocked_at || null
    }));

    return {
      friends,
      incoming_requests: incoming,
      outgoing_requests: outgoing,
      conversations,
      game_invites: invites,
      blocked,
      unread_messages: conversations.reduce((sum, item) => sum + item.unread_count, 0)
    };
  }

  async sendDirectMessage(fromProfileId, toProfileId, message, nowMs = Date.now()) {
    const text = validateChatMessage(message);
    if (!await this.areProfilesFriends(fromProfileId, toProfileId)) {
      throw new Error('messages are allowed only between friends');
    }
    if (await this.isBlockedBetween(fromProfileId, toProfileId)) {
      throw new Error('messages are blocked');
    }

    const conversationId = conversationIdFor(fromProfileId, toProfileId);
    const conversationRef = this.conversationRef(conversationId);
    const messageId = crypto.randomUUID();
    const messageRef = conversationRef.collection('messages').doc(messageId);
    const senderMetaRef = this.profileConversationRef(fromProfileId, conversationId);
    const receiverMetaRef = this.profileConversationRef(toProfileId, conversationId);
    const nowIso = new Date(nowMs).toISOString();
    const preview = text.slice(0, 120);

    await this.db.runTransaction(async tx => {
      const receiverMeta = await tx.get(receiverMetaRef);
      const receiverUnread = Number(receiverMeta.data()?.unread_count || 0) + 1;

      tx.set(conversationRef, {
        conversation_id: conversationId,
        participants: [fromProfileId, toProfileId].sort(),
        updated_at: nowIso,
        last_message_preview: preview
      }, { merge: true });

      tx.set(messageRef, {
        id: messageId,
        conversation_id: conversationId,
        from_profile_id: fromProfileId,
        to_profile_id: toProfileId,
        text,
        created_at: nowIso
      }, { merge: false });

      tx.set(senderMetaRef, {
        conversation_id: conversationId,
        other_profile_id: toProfileId,
        updated_at: nowIso,
        last_message_preview: preview,
        unread_count: 0
      }, { merge: true });

      tx.set(receiverMetaRef, {
        conversation_id: conversationId,
        other_profile_id: fromProfileId,
        updated_at: nowIso,
        last_message_preview: preview,
        unread_count: receiverUnread
      }, { merge: true });
    });

    return {
      id: messageId,
      conversation_id: conversationId,
      from_profile_id: fromProfileId,
      to_profile_id: toProfileId,
      text,
      created_at: nowIso
    };
  }

  async listDirectMessages(profileId, otherProfileId, limit = 100) {
    if (!await this.areProfilesFriends(profileId, otherProfileId)) {
      throw new Error('messages are allowed only between friends');
    }
    const conversationId = conversationIdFor(profileId, otherProfileId);
    const snap = await this.conversationRef(conversationId)
      .collection('messages')
      .orderBy('created_at', 'desc')
      .limit(Math.max(1, Math.min(200, Number(limit) || 100)))
      .get();

    const items = snap.docs.map(doc => doc.data()).reverse();
    await this.profileConversationRef(profileId, conversationId).set({
      unread_count: 0,
      last_read_at: new Date().toISOString()
    }, { merge: true });

    return {
      conversation_id: conversationId,
      messages: items
    };
  }

  async createGameInvite(fromProfileId, toProfileId, gameId, nowMs = Date.now()) {
    if (!await this.areProfilesFriends(fromProfileId, toProfileId)) {
      throw new Error('game invites are allowed only between friends');
    }
    if (await this.isBlockedBetween(fromProfileId, toProfileId)) {
      throw new Error('game invites are blocked');
    }

    const [senderMembership, gameDoc] = await Promise.all([
      this.profileGamesRef(fromProfileId).doc(String(gameId)).get(),
      this.db.collection('games').doc(String(gameId)).get()
    ]);
    if (!senderMembership.exists) throw new Error('sender is not a member of this game');
    if (!gameDoc.exists) throw new Error('game not found');

    const lifecycle = gameDoc.data()?.lifecycle || {};
    if (lifecycle.status !== GAME_STATUS.LOBBY || lifecycle.game_mode !== GAME_MODE.MULTIPLAYER) {
      throw new Error('game is not accepting invitations');
    }

    const existingPlayer = await this.db.collection('games').doc(String(gameId))
      .collection('players')
      .where('profile_id', '==', toProfileId)
      .limit(1)
      .get();
    if (!existingPlayer.empty) throw new Error('friend is already in this game');

    const inviteId = crypto.createHash('sha256')
      .update(`${fromProfileId}:${toProfileId}:${gameId}`)
      .digest('hex')
      .slice(0, 32);
    const inviteRef = this.profileGameInviteRef(toProfileId, inviteId);
    const existingInvite = await inviteRef.get();
    if (
      existingInvite.exists &&
      existingInvite.data()?.status === 'PENDING' &&
      (!existingInvite.data()?.expires_at || Date.parse(existingInvite.data().expires_at) > nowMs)
    ) {
      throw new Error('game invite already sent');
    }

    const createdAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(
      nowMs + SOCIAL_LIMITS.inviteLifetimeDays * 24 * 60 * 60 * 1000
    ).toISOString();

    await inviteRef.set({
      invite_id: inviteId,
      from_profile_id: fromProfileId,
      to_profile_id: toProfileId,
      game_id: String(gameId),
      status: 'PENDING',
      created_at: createdAt,
      expires_at: expiresAt
    }, { merge: false });

    return {
      invite_id: inviteId,
      game_id: String(gameId),
      created_at: createdAt,
      expires_at: expiresAt
    };
  }

  async getGameInvite(profileId, inviteId) {
    const doc = await this.profileGameInviteRef(profileId, inviteId).get();
    return doc.exists ? doc.data() : null;
  }

  async resolveGameInvite(profileId, inviteId, status, nowMs = Date.now()) {
    if (!['ACCEPTED', 'DECLINED'].includes(status)) throw new Error('invalid game invite status');
    const ref = this.profileGameInviteRef(profileId, inviteId);
    const doc = await ref.get();
    if (!doc.exists) throw new Error('game invite not found');
    await ref.set({
      ...doc.data(),
      status,
      resolved_at: new Date(nowMs).toISOString()
    }, { merge: false });
    return { ...doc.data(), status };
  }

  async updateProfileAvatar(profileId, avatarId, nowMs = Date.now()) {
    const normalized = normalizeAvatarId(avatarId);
    const ref = this.profileRef(profileId);
    const doc = await ref.get();
    if (!doc.exists) throw new Error('profile not found');

    await ref.update({
      avatar_id: normalized,
      updated_at: new Date(nowMs).toISOString()
    });

    return this.getProfile(profileId);
  }

  async heartbeatProfileActivity(profileId, { gameId = null } = {}, nowMs = Date.now()) {
    const ref = this.profileRef(profileId);
    const nowIso = new Date(nowMs).toISOString();

    return this.db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (!doc.exists) throw new Error('profile not found');

      const profile = doc.data();
      const stats = normalizeProfileStats(profile.stats);
      const lastIso = profile.activity?.last_game_heartbeat_at || null;
      const lastMs = lastIso ? Date.parse(lastIso) : NaN;
      let addedSeconds = 0;

      if (gameId && Number.isFinite(lastMs)) {
        const sameGame = profile.activity?.current_game_id === String(gameId);
        const deltaSeconds = Math.floor((nowMs - lastMs) / 1000);
        if (sameGame && deltaSeconds > 0 && deltaSeconds <= 120) {
          addedSeconds = deltaSeconds;
          stats.play_seconds += deltaSeconds;
        }
      }

      const activity = {
        ...(profile.activity || {}),
        last_seen_at: nowIso,
        ...(gameId ? {
          current_game_id: String(gameId),
          last_game_heartbeat_at: nowIso
        } : {})
      };

      tx.update(ref, {
        stats,
        activity,
        updated_at: nowIso
      });

      return {
        added_seconds: addedSeconds,
        play_seconds: stats.play_seconds,
        heartbeat_at: nowIso,
        game_id: gameId ? String(gameId) : null
      };
    });
  }

  async heartbeatProfilePresence(profileId, nowMs = Date.now()) {
    const ref = this.profileRef(profileId);
    const doc = await ref.get();
    if (!doc.exists) throw new Error('profile not found');
    const profile = doc.data();
    const nowIso = new Date(nowMs).toISOString();
    await ref.update({
      activity: {
        ...(profile.activity || {}),
        last_seen_at: nowIso
      },
      updated_at: nowIso
    });
    return { last_seen_at: nowIso };
  }

  async profilePresence(profile, nowMs = Date.now()) {
    if (!profile) return { status: 'OFFLINE', online: false, in_game: false, game: null };

    const lastSeenMs = profile.activity?.last_seen_at
      ? Date.parse(profile.activity.last_seen_at)
      : NaN;
    const gameHeartbeatMs = profile.activity?.last_game_heartbeat_at
      ? Date.parse(profile.activity.last_game_heartbeat_at)
      : NaN;

    const online = Number.isFinite(lastSeenMs) && (nowMs - lastSeenMs) <= 120_000;
    const gameFresh = Number.isFinite(gameHeartbeatMs) && (nowMs - gameHeartbeatMs) <= 120_000;
    const gameId = gameFresh ? profile.activity?.current_game_id : null;

    if (!gameId) {
      return {
        status: online ? 'ONLINE' : 'OFFLINE',
        online,
        in_game: false,
        game: null,
        last_seen_at: profile.activity?.last_seen_at || null
      };
    }

    const gameDoc = await this.db.collection('games').doc(String(gameId)).get();
    const lifecycle = gameDoc.exists ? gameDoc.data()?.lifecycle || null : null;
    const inGame = lifecycle?.status === GAME_STATUS.RUNNING;

    return {
      status: inGame ? 'IN_GAME' : (online ? 'ONLINE' : 'OFFLINE'),
      online: online || inGame,
      in_game: inGame,
      game: inGame ? {
        game_id: String(gameId),
        room_name: lifecycle?.room_name || 'Игра',
        visibility: lifecycle?.visibility || GAME_VISIBILITY.PRIVATE,
        game_mode: lifecycle?.game_mode || GAME_MODE.MULTIPLAYER,
        status: lifecycle?.status || null
      } : null,
      last_seen_at: profile.activity?.last_seen_at || null
    };
  }

  async publicProfileView(profileId) {
    const profile = await this.getProfile(profileId);
    if (!profile) return null;
    const presence = await this.profilePresence(profile);
    return {
      profile,
      presence
    };
  }

  async recordProfileRankedResult(profileId, gameId, { won }, nowMs = Date.now()) {
    const profileRef = this.profileRef(profileId);
    const membershipRef = this.profileGamesRef(profileId).doc(String(gameId));
    const nowIso = new Date(nowMs).toISOString();

    return this.db.runTransaction(async tx => {
      const [profileDoc, membershipDoc] = await Promise.all([
        tx.get(profileRef),
        tx.get(membershipRef)
      ]);

      if (!profileDoc.exists) throw new Error('profile not found');
      if (!membershipDoc.exists) throw new Error('profile game membership not found');

      const membership = membershipDoc.data();
      if (membership.result_recorded_at) {
        return {
          duplicate: true,
          stats: normalizeProfileStats(profileDoc.data().stats)
        };
      }

      const stats = applyRankedResult(profileDoc.data().stats, { won: Boolean(won) });
      tx.update(profileRef, {
        stats,
        updated_at: nowIso
      });
      tx.set(membershipRef, {
        ...membership,
        ranked_result: won ? 'WIN' : 'LOSS',
        result_recorded_at: nowIso
      }, { merge: false });

      return {
        duplicate: false,
        stats
      };
    });
  }

  async addProfileSession(profileId, session) {
    await this.profileSessionRef(profileId, session.session_id).set({
      session_id: session.session_id,
      token_hash: session.token_hash,
      created_at: session.created_at,
      expires_at: session.expires_at,
      revoked_at: null
    }, { merge: false });
    return session;
  }

  async authenticateProfileSession(token, nowMs = Date.now()) {
    const parsed = parseProfileToken(token);
    if (!parsed) return null;

    const [profileDoc, sessionDoc] = await Promise.all([
      this.profileRef(parsed.profile_id).get(),
      this.profileSessionRef(parsed.profile_id, parsed.session_id).get()
    ]);

    if (!profileDoc.exists || !sessionDoc.exists) return null;

    const session = sessionDoc.data();
    if (session.revoked_at) return null;
    if (!session.expires_at || Date.parse(session.expires_at) <= nowMs) return null;

    const actualHash = hashProfileToken(token);
    if (!safeHashEqual(session.token_hash, actualHash)) return null;

    return profileDoc.data();
  }

  async revokeProfileSession(token, nowMs = Date.now()) {
    const parsed = parseProfileToken(token);
    if (!parsed) return false;
    const ref = this.profileSessionRef(parsed.profile_id, parsed.session_id);
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.update({ revoked_at: new Date(nowMs).toISOString() });
    return true;
  }

  async linkPlayerToProfile(playerId, profileId) {
    const playerRef = this.playerRef(playerId);
    const profileGameRef = this.profileGamesRef(profileId).doc(this.gameId);

    await this.db.runTransaction(async tx => {
      const [playerDoc, profileDoc] = await Promise.all([
        tx.get(playerRef),
        tx.get(this.profileRef(profileId))
      ]);

      if (!playerDoc.exists) throw new Error('player not found');
      if (!profileDoc.exists) throw new Error('profile not found');

      const player = playerDoc.data();
      if (player.profile_id && player.profile_id !== profileId) {
        throw new Error('game player already linked to another profile');
      }

      tx.update(playerRef, { profile_id: profileId });
      tx.set(profileGameRef, {
        game_id: this.gameId,
        player_id: playerId,
        linked_at: new Date().toISOString()
      }, { merge: true });
    });

    return true;
  }

  async findPlayerByProfileId(profileId) {
    if (!profileId) return null;
    const snap = await this.playersRef()
      .where('profile_id', '==', profileId)
      .limit(1)
      .get();
    return snap.empty ? null : snap.docs[0].data();
  }

  async listProfileGames(profileId) {
    const memberships = await this.profileGamesRef(profileId).get();
    const items = [];

    for (const membershipDoc of memberships.docs) {
      const membership = membershipDoc.data();
      const gameId = membership.game_id || membershipDoc.id;
      const [gameDoc, playerDoc] = await Promise.all([
        this.db.collection('games').doc(gameId).get(),
        membership.player_id
          ? this.db.collection('games').doc(gameId).collection('players').doc(membership.player_id).get()
          : Promise.resolve(null)
      ]);

      if (!gameDoc.exists) continue;
      items.push({
        game_id: gameId,
        game: gameDoc.data(),
        player: playerDoc?.exists ? playerDoc.data() : null,
        linked_at: membership.linked_at || null
      });
    }

    return items;
  }

  async getPlayer(playerId) {
    if (!playerId) return null;
    const doc = await this.playerRef(playerId).get();
    return doc.exists ? doc.data() : null;
  }

  async listPlayers() {
    const snap = await this.playersRef().orderBy('joined_at', 'asc').get();
    return snap.docs.map(doc => doc.data());
  }

  async authenticateToken(token) {
    const playerId = playerIdFromToken(token);
    if (!playerId) return null;
    const player = await this.getPlayer(playerId);
    if (!player) return null;
    const actual = hashAccessToken(token);
    if (!safeTokenHashEqual(player.token_hash, actual)) return null;
    return player;
  }

  async addPlayer(player) {
    const gameRef = this.gameRef();
    const playerRef = this.playerRef(player.id);

    await this.db.runTransaction(async tx => {
      const [gameDoc, existingPlayer] = await Promise.all([
        tx.get(gameRef),
        tx.get(playerRef)
      ]);

      if (!gameDoc.exists) throw new Error('game not found');
      if (existingPlayer.exists) throw new Error('player already joined');

      const game = gameDoc.data();
      const lifecycle = structuredClone(game.lifecycle || {});
      if (lifecycle.status !== GAME_STATUS.LOBBY) throw new Error('game is not joinable');

      if (player.role === PLAYER_ROLE.SPECTATOR) {
        lifecycle.spectator_count = Number(lifecycle.spectator_count || 0) + 1;
      } else {
        const current = Number(lifecycle.player_count || 0);
        const max = Number(lifecycle.max_players || 6);
        if (current >= max) throw new Error('game is full');
        lifecycle.player_count = current + 1;
      }

      const nextRevision = Number(game.state_revision || 0) + 1;
      tx.set(playerRef, plain(player), { merge: false });
      tx.update(gameRef, { lifecycle, state_revision: nextRevision });
    });

    return player;
  }

  async addSpectator(player) {
    if (player.role !== PLAYER_ROLE.SPECTATOR) throw new Error('spectator role required');

    const gameRef = this.gameRef();
    const playerRef = this.playerRef(player.id);

    await this.db.runTransaction(async tx => {
      const [gameDoc, existingPlayer] = await Promise.all([
        tx.get(gameRef),
        tx.get(playerRef)
      ]);

      if (!gameDoc.exists) throw new Error('game not found');
      if (existingPlayer.exists) throw new Error('player already joined');

      const game = gameDoc.data();
      const lifecycle = structuredClone(game.lifecycle || {});
      if (![GAME_STATUS.LOBBY, GAME_STATUS.RUNNING].includes(lifecycle.status)) {
        throw new Error('game is not watchable');
      }

      lifecycle.spectator_count = Number(lifecycle.spectator_count || 0) + 1;
      const nextRevision = Number(game.state_revision || 0) + 1;
      tx.set(playerRef, plain(player), { merge: false });
      tx.update(gameRef, { lifecycle, state_revision: nextRevision });
    });

    return player;
  }

  async claimHouse(playerId, house, constants) {
    const gameRef = this.gameRef();
    const playerRef = this.playerRef(playerId);

    return this.db.runTransaction(async tx => {
      const [gameDoc, playerDoc] = await Promise.all([
        tx.get(gameRef),
        tx.get(playerRef)
      ]);

      if (!gameDoc.exists) throw new Error('game not found');
      if (!playerDoc.exists) throw new Error('player not found');
      if (!constants.houses.includes(house)) throw new Error('unknown house');

      const game = gameDoc.data();
      const player = playerDoc.data();
      const lifecycle = structuredClone(game.lifecycle || {});

      if (lifecycle.status !== GAME_STATUS.LOBBY) throw new Error('house selection is closed');
      if (player.role === PLAYER_ROLE.SPECTATOR) throw new Error('spectator cannot claim a house');

      const claims = structuredClone(lifecycle.house_claims || {});
      const occupiedBy = claims[house];
      if (occupiedBy && occupiedBy !== playerId) throw new Error('house already claimed');

      if (player.house && player.house !== house) {
        throw new Error('player already controls another house');
      }

      claims[house] = playerId;
      lifecycle.house_claims = claims;
      player.house = house;

      const nextRevision = Number(game.state_revision || 0) + 1;
      tx.update(gameRef, { lifecycle, state_revision: nextRevision });
      tx.update(playerRef, { house });

      return { house, player_id: playerId };
    });
  }

  async releaseHouse(playerId) {
    const gameRef = this.gameRef();
    const playerRef = this.playerRef(playerId);

    return this.db.runTransaction(async tx => {
      const [gameDoc, playerDoc] = await Promise.all([
        tx.get(gameRef),
        tx.get(playerRef)
      ]);

      if (!gameDoc.exists) throw new Error('game not found');
      if (!playerDoc.exists) throw new Error('player not found');

      const game = gameDoc.data();
      const player = playerDoc.data();
      const lifecycle = structuredClone(game.lifecycle || {});

      if (lifecycle.status !== GAME_STATUS.LOBBY) {
        throw new Error('house selection is closed');
      }
      if (!player.house) return { released: null, player_id: playerId };

      const house = player.house;
      const claims = structuredClone(lifecycle.house_claims || {});
      if (claims[house] === playerId) delete claims[house];

      lifecycle.house_claims = claims;
      const nextRevision = Number(game.state_revision || 0) + 1;

      tx.update(gameRef, { lifecycle, state_revision: nextRevision });
      tx.update(playerRef, { house: null });

      return { released: house, player_id: playerId };
    });
  }

  async startGame(playerId, constants, nowMs = Date.now()) {
    const gameRef = this.gameRef();
    const playerRef = this.playerRef(playerId);

    return this.db.runTransaction(async tx => {
      const [gameDoc, playerDoc] = await Promise.all([
        tx.get(gameRef),
        tx.get(playerRef)
      ]);

      if (!gameDoc.exists) throw new Error('game not found');
      if (!playerDoc.exists) throw new Error('player not found');

      const game = gameDoc.data();
      const player = playerDoc.data();
      if (!canAdminister(player)) throw new Error('admin role required');

      validateStart(game, constants);

      const lifecycle = structuredClone(game.lifecycle);
      lifecycle.status = GAME_STATUS.RUNNING;
      lifecycle.started_at = new Date(nowMs).toISOString();
      lifecycle.invite_code = null;

      const nextRevision = Number(game.state_revision || 0) + 1;
      tx.update(gameRef, {
        lifecycle,
        updated_at: lifecycle.started_at,
        state_revision: nextRevision
      });
      return lifecycle;
    });
  }

  async finishGame(playerId, {
    nowMs = Date.now(),
    reason = null
  } = {}) {
    const gameRef = this.gameRef();
    const playerRef = this.playerRef(playerId);

    return this.db.runTransaction(async tx => {
      const [gameDoc, playerDoc] = await Promise.all([
        tx.get(gameRef),
        tx.get(playerRef)
      ]);

      if (!gameDoc.exists) throw new Error('game not found');
      if (!playerDoc.exists) throw new Error('player not found');

      const game = gameDoc.data();
      const player = playerDoc.data();
      if (!canAdminister(player)) throw new Error('admin role required');

      const lifecycle = structuredClone(game.lifecycle || {});
      if (lifecycle.status !== GAME_STATUS.RUNNING) {
        throw new Error('only a running game can be finished');
      }

      lifecycle.status = GAME_STATUS.FINISHED;
      lifecycle.finished_at = new Date(nowMs).toISOString();
      lifecycle.finish_reason = reason ? String(reason).slice(0, 200) : null;

      const nextRevision = Number(game.state_revision || 0) + 1;
      tx.update(gameRef, {
        lifecycle,
        updated_at: lifecycle.finished_at,
        state_revision: nextRevision
      });

      return lifecycle;
    });
  }

  async archiveGame(playerId, nowMs = Date.now()) {
    const gameRef = this.gameRef();
    const playerRef = this.playerRef(playerId);

    return this.db.runTransaction(async tx => {
      const [gameDoc, playerDoc] = await Promise.all([
        tx.get(gameRef),
        tx.get(playerRef)
      ]);

      if (!gameDoc.exists) throw new Error('game not found');
      if (!playerDoc.exists) throw new Error('player not found');

      const game = gameDoc.data();
      const player = playerDoc.data();
      if (!canAdminister(player)) throw new Error('admin role required');

      const lifecycle = structuredClone(game.lifecycle || {});
      if (lifecycle.status !== GAME_STATUS.FINISHED) {
        throw new Error('only a finished game can be archived');
      }

      lifecycle.status = GAME_STATUS.ARCHIVED;
      lifecycle.archived_at = new Date(nowMs).toISOString();

      const nextRevision = Number(game.state_revision || 0) + 1;
      tx.update(gameRef, {
        lifecycle,
        updated_at: lifecycle.archived_at,
        state_revision: nextRevision
      });

      return lifecycle;
    });
  }

  async listOpenPublicGames(limit = 50) {
    const snap = await this.db.collection('games')
      .where('lifecycle.status', '==', GAME_STATUS.LOBBY)
      .limit(Math.max(1, Math.min(100, Number(limit) || 50)))
      .get();

    return snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(game =>
        game.lifecycle?.game_mode === GAME_MODE.MULTIPLAYER &&
        game.lifecycle?.visibility === GAME_VISIBILITY.PUBLIC &&
        Number(game.lifecycle?.player_count || 0) < Number(game.lifecycle?.max_players || 6)
      )
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .map(game => ({
        game_id: game.id,
        room_name: game.lifecycle?.room_name || 'Открытая комната',
        player_count: Number(game.lifecycle?.player_count || 0),
        max_players: Number(game.lifecycle?.max_players || 6),
        spectator_count: Number(game.lifecycle?.spectator_count || 0),
        claimed_houses: Object.keys(game.lifecycle?.house_claims || {}),
        created_at: game.created_at || game.lifecycle?.created_at || null,
        ruleset_version: game.lifecycle?.ruleset_version || game.ruleset_version || null
      }));
  }

  async findGameIdByInviteCode(inviteCode) {
    const code = String(inviteCode || '').trim().toUpperCase();
    if (!code) return null;

    const snap = await this.db.collection('games')
      .where('lifecycle.invite_code', '==', code)
      .limit(2)
      .get();

    if (snap.empty) return null;
    const live = snap.docs.find(doc => doc.data()?.lifecycle?.status === GAME_STATUS.LOBBY);
    return live?.id || null;
  }


  commandReceiptRef(commandId) {
    const digest = crypto.createHash('sha256').update(String(commandId)).digest('hex');
    return this.gameRef().collection('command_receipts').doc(digest);
  }

  async getCommandReceipt(commandId) {
    if (!commandId) return null;
    const doc = await this.commandReceiptRef(commandId).get();
    return doc.exists ? doc.data() : null;
  }

  async load() {
    const doc = await this.gameRef().get();
    if (!doc.exists) return null;

    const game = doc.data();
    game.state_revision = Number(game.state_revision || 0);
    const sessionId = game.session_id;
    if (!sessionId) throw new Error('Firestore game is missing session_id');

    const session = this.sessionRef(sessionId);
    const [ordersSnap, jobsSnap, eventsSnap] = await Promise.all([
      session.collection('orders').get(),
      session.collection('jobs').get(),
      session.collection('events').orderBy('seq', 'desc').limit(2000).get()
    ]);

    const orders = sortByIso(ordersSnap.docs.map(d => d.data()));
    const jobs = sortByIso(jobsSnap.docs.map(d => d.data()));
    const auditLog = eventsSnap.docs.map(d => d.data()).reverse();

    if (!game.state) throw new Error('Firestore game is missing state');

    const repaired = repairForeignWarriors(game.state);
    game.state = repaired.state;
    game.state.journal = [];
    if (repaired.repairs.length) {
      game.state.journal.push({
        kind: 'STATE_REPAIR',
        reason: 'REMOVED_FOREIGN_WARRIORS',
        repairs: repaired.repairs
      });
    }

    game.orders = orders;
    game.jobs = jobs;
    game.audit_log = auditLog;
    game.audit_journal_cursor = 0;

    const maxSeq = auditLog.reduce((max, item) => Math.max(max, Number(item.seq || 0)), 0);
    game.audit_seq = Math.max(Number(game.audit_seq || 1), maxSeq + 1);

    this.orderCache = new Map(orders.map(item => [item.id, JSON.stringify(item)]));
    this.jobCache = new Map(jobs.map(item => [item.id, JSON.stringify(item)]));
    this.eventMaxSeq = maxSeq;

    return game;
  }

  changedCollectionItems(items, cache, idField = 'id') {
    const changed = [];
    for (const item of items) {
      const id = item?.[idField];
      if (!id) continue;
      const normalized = plain(item);
      const serialized = JSON.stringify(normalized);
      if (cache.get(id) === serialized) continue;
      changed.push([String(id), normalized, serialized]);
    }
    return changed;
  }

  freshEvents(auditLog = []) {
    return auditLog
      .filter(item => Number(item.seq || 0) > this.eventMaxSeq)
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
  }

  async save(game, {
    commandId = null,
    commandResponse = null,
    commandStatus = 200
  } = {}) {
    const sessionId = game.session_id;
    if (!sessionId) throw new Error('cannot persist game without session_id');

    const gameRef = this.gameRef();
    const session = this.sessionRef(sessionId);
    const expectedRevision = Number(game.state_revision || 0);
    const changedOrders = this.changedCollectionItems(game.orders || [], this.orderCache);
    const changedJobs = this.changedCollectionItems(game.jobs || [], this.jobCache);
    const freshEvents = this.freshEvents(game.audit_log || []);
    const receiptRef = commandId ? this.commandReceiptRef(commandId) : null;

    const writeCount =
      2 + changedOrders.length + changedJobs.length + freshEvents.length + (receiptRef ? 1 : 0);
    if (writeCount > 450) {
      throw new Error(`atomic Firestore write set too large: ${writeCount}`);
    }

    const result = await this.db.runTransaction(async tx => {
      const gameDoc = await tx.get(gameRef);
      let receiptDoc = null;
      if (receiptRef) receiptDoc = await tx.get(receiptRef);

      if (receiptDoc?.exists) {
        return { duplicate: true, receipt: receiptDoc.data() };
      }

      const currentRevision = gameDoc.exists
        ? Number(gameDoc.data()?.state_revision || 0)
        : 0;

      if (currentRevision !== expectedRevision) {
        const error = new Error(
          `stale game state: expected revision ${expectedRevision}, current ${currentRevision}`
        );
        error.code = 'STALE_GAME_STATE';
        throw error;
      }

      const nextRevision = expectedRevision + 1;
      game.state_revision = nextRevision;
      game.next_due_at = calculateNextDueAt(game);
      const current = compactGameDoc(game);

      tx.set(gameRef, {
        ...current,
        state_revision: nextRevision,
        storage_backend: 'firestore',
        firestore_database: this.databaseId
      }, { merge: false });

      tx.set(session, {
        session_id: sessionId,
        game_id: game.id,
        created_at: game.created_at,
        updated_at: game.updated_at,
        session_metrics: plain(game.session_metrics || {}),
        audit_seq: Number(game.audit_seq || 1),
        state_revision: nextRevision
      }, { merge: true });

      for (const [id, normalized] of changedOrders) {
        tx.set(session.collection('orders').doc(id), normalized, { merge: false });
      }
      for (const [id, normalized] of changedJobs) {
        tx.set(session.collection('jobs').doc(id), normalized, { merge: false });
      }
      for (const item of freshEvents) {
        const seq = Number(item.seq || 0);
        const id = String(seq).padStart(10, '0');
        tx.set(session.collection('events').doc(id), plain(item), { merge: false });
      }

      if (receiptRef) {
        tx.set(receiptRef, {
          command_id_hash: receiptRef.id,
          created_at: new Date().toISOString(),
          state_revision: nextRevision,
          status_code: Number(commandStatus || 200),
          response: plain(commandResponse || {})
        }, { merge: false });
      }

      return {
        duplicate: false,
        state_revision: nextRevision
      };
    });

    if (result.duplicate) return result;

    for (const [id, , serialized] of changedOrders) this.orderCache.set(id, serialized);
    for (const [id, , serialized] of changedJobs) this.jobCache.set(id, serialized);
    if (freshEvents.length) {
      this.eventMaxSeq = Math.max(
        this.eventMaxSeq,
        ...freshEvents.map(item => Number(item.seq || 0))
      );
    }

    return result;
  }

  async loadOrCreate(map, constants) {
    const existing = await this.load();
    if (existing) {
      this.loadedExistingAtStartup = true;
      return existing;
    }
    const created = createOnlineGame(map, constants, { id: this.gameId });
    await this.save(created);
    this.loadedExistingAtStartup = false;
    return created;
  }

  async reset(map, constants) {
    const currentDoc = await this.gameRef().get();
    const currentRevision = currentDoc.exists
      ? Number(currentDoc.data()?.state_revision || 0)
      : 0;

    const created = createOnlineGame(map, constants, { id: this.gameId });
    created.state_revision = currentRevision;

    this.orderCache = new Map();
    this.jobCache = new Map();
    this.eventMaxSeq = 0;
    await this.save(created);
    return created;
  }

  async listDueGameIds(nowMs = Date.now(), limit = 100) {
    const nowIso = new Date(nowMs).toISOString();
    const snap = await this.db.collection('games')
      .where('next_due_at', '<=', nowIso)
      .limit(Math.max(1, Math.min(250, Number(limit) || 100)))
      .get();

    return snap.docs
      .filter(doc => doc.data()?.lifecycle?.status === GAME_STATUS.RUNNING)
      .map(doc => doc.id);
  }

  async saveCheckpoint(snapshot) {
    const payload = compactCheckpoint(snapshot);
    const savedAt = payload.saved_at || new Date().toISOString();
    const sessionId = payload.game?.session_id || 'unknown-session';
    const id = `${sessionId}_${savedAt.replace(/[:.]/g, '-')}`;

    await this.gameRef().collection('snapshots').doc(id).set({
      snapshot_id: id,
      session_id: sessionId,
      saved_at: savedAt,
      schema_version: Number(payload.schema_version || 1),
      payload
    });

    return { snapshot_id: id, saved_at: savedAt };
  }

  async latestCheckpoint() {
    const snap = await this.gameRef()
      .collection('snapshots')
      .orderBy('saved_at', 'desc')
      .limit(1)
      .get();

    if (snap.empty) return null;
    return snap.docs[0].data()?.payload || null;
  }

  status() {
    return {
      backend: 'firestore',
      project_id: this.projectId || null,
      database_id: this.databaseId,
      game_id: this.gameId,
      loaded_existing_at_startup: this.loadedExistingAtStartup
    };
  }
}
