// In-memory stand-in for the parts of @google-cloud/firestore the game store uses.
// Local development and tests only: nothing is persisted and there is no real
// transaction isolation. Never used in the deployed service.

const documents = globalThis.__aobFakeFirestore ||= new Map();

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function getPath(object, field) {
  return String(field).split('.').reduce(
    (value, key) => (value === null || value === undefined ? undefined : value[key]),
    object
  );
}

function setPath(object, field, value) {
  const keys = String(field).split('.');
  let cursor = object;
  for (const key of keys.slice(0, -1)) {
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
}

function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (typeof target[key] !== 'object' || target[key] === null || Array.isArray(target[key])) {
        target[key] = {};
      }
      merge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

class Snapshot {
  constructor(ref, data) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = data !== undefined;
    this.stored = data;
  }

  data() {
    return clone(this.stored);
  }
}

class DocumentReference {
  constructor(path) {
    this.path = path;
    this.id = path.split('/').pop();
  }

  collection(name) {
    return new Query(`${this.path}/${name}`);
  }

  async get() {
    return new Snapshot(this, documents.get(this.path));
  }

  async set(data, { merge: mergeFields = false } = {}) {
    const next = mergeFields && documents.has(this.path)
      ? merge(clone(documents.get(this.path)), clone(data))
      : clone(data);
    documents.set(this.path, next);
  }

  async update(data) {
    if (!documents.has(this.path)) throw new Error(`no document to update: ${this.path}`);
    const next = clone(documents.get(this.path));
    for (const [field, value] of Object.entries(clone(data))) setPath(next, field, value);
    documents.set(this.path, next);
  }

  async delete() {
    documents.delete(this.path);
  }
}

let autoId = 0;

class Query {
  constructor(path, filters = [], order = null, max = null) {
    this.path = path;
    this.filters = filters;
    this.order = order;
    this.max = max;
  }

  doc(id = `auto-${(autoId += 1)}`) {
    return new DocumentReference(`${this.path}/${id}`);
  }

  where(field, op, value) {
    return new Query(this.path, [...this.filters, { field, op, value }], this.order, this.max);
  }

  orderBy(field, direction = 'asc') {
    return new Query(this.path, this.filters, { field, direction }, this.max);
  }

  limit(max) {
    return new Query(this.path, this.filters, this.order, max);
  }

  async get() {
    const prefix = `${this.path}/`;
    let rows = [...documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, data]) => ({ path, data }));

    for (const { field, op, value } of this.filters) {
      rows = rows.filter(({ data }) => {
        const actual = getPath(data, field);
        if (op === '==') return actual === value;
        if (op === '<=') return actual !== undefined && actual !== null && actual <= value;
        throw new Error(`fake Firestore does not support operator ${op}`);
      });
    }

    if (this.order) {
      const { field, direction } = this.order;
      const sign = direction === 'desc' ? -1 : 1;
      rows = rows.filter(({ data }) => getPath(data, field) !== undefined);
      rows.sort((a, b) => {
        const left = getPath(a.data, field);
        const right = getPath(b.data, field);
        return (left < right ? -1 : left > right ? 1 : 0) * sign;
      });
    }

    if (this.max !== null) rows = rows.slice(0, this.max);
    const docs = rows.map(({ path, data }) => new Snapshot(new DocumentReference(path), data));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class WriteSet {
  constructor() {
    this.writes = [];
  }

  get(target) {
    return target.get();
  }

  set(ref, data, options) {
    this.writes.push(() => ref.set(data, options));
    return this;
  }

  update(ref, data) {
    this.writes.push(() => ref.update(data));
    return this;
  }

  delete(ref) {
    this.writes.push(() => ref.delete());
    return this;
  }

  async commit() {
    for (const write of this.writes) await write();
    this.writes = [];
  }
}

let transactionChain = Promise.resolve();

export class Firestore {
  collection(name) {
    return new Query(name);
  }

  batch() {
    return new WriteSet();
  }

  // Transactions run one at a time; writes apply only if the callback succeeds.
  runTransaction(callback) {
    const run = transactionChain.then(async () => {
      const tx = new WriteSet();
      const result = await callback(tx);
      await tx.commit();
      return result;
    });
    transactionChain = run.catch(() => {});
    return run;
  }
}
