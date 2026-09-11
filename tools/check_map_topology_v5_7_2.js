#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "map", "canonical_topology_v5.7.2.json");
const topo = JSON.parse(fs.readFileSync(FILE, "utf8"));

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function edgeKey(edge) {
  invariant(Array.isArray(edge) && edge.length === 2, `Invalid edge: ${JSON.stringify(edge)}`);
  return [...edge].sort().join("<->");
}

invariant(topo.version === "V5.7.2-DEV", `Wrong topology version: ${topo.version}`);
invariant(topo.status === "CANONICAL_TOPOLOGY", `Wrong topology status: ${topo.status}`);
invariant(Array.isArray(topo.territories), "territories missing");
invariant(Array.isArray(topo.ports), "ports missing");
invariant(Array.isArray(topo.land_edges), "land_edges missing");
invariant(Array.isArray(topo.sea_edges), "sea_edges missing");

const territories = new Set(topo.territories);
const ports = new Set(topo.ports);
const land = new Set(topo.land_edges.map(edgeKey));
const sea = new Set(topo.sea_edges.map(edgeKey));

invariant(territories.size === 52, `Expected 52 unique territories, got ${territories.size}`);
invariant(ports.size === 16, `Expected 16 unique ports, got ${ports.size}`);
invariant(land.size === 81, `Expected 81 unique land edges, got ${land.size}`);
invariant(sea.size === 23, `Expected 23 unique sea edges, got ${sea.size}`);
invariant(topo.land_edges.length === land.size, "Duplicate land edge detected");
invariant(topo.sea_edges.length === sea.size, "Duplicate sea edge detected");

for (const port of ports) invariant(territories.has(port), `Unknown port territory: ${port}`);
for (const [a,b] of [...topo.land_edges, ...topo.sea_edges]) {
  invariant(territories.has(a), `Unknown edge endpoint: ${a}`);
  invariant(territories.has(b), `Unknown edge endpoint: ${b}`);
  invariant(a !== b, `Self-edge detected: ${a}`);
}
for (const [a,b] of topo.sea_edges) {
  invariant(ports.has(a), `Sea edge starts at non-port: ${a}`);
  invariant(ports.has(b), `Sea edge ends at non-port: ${b}`);
}

const capitals = topo.capitals || {};
invariant(Object.keys(capitals).length === 6, `Expected 6 capitals, got ${Object.keys(capitals).length}`);
for (const [house, territory] of Object.entries(capitals)) {
  invariant(territories.has(territory), `Capital ${house} points to unknown territory ${territory}`);
}

invariant(topo.counts?.territories === 52, "Declared territory count mismatch");
invariant(topo.counts?.land_edges === 81, "Declared land edge count mismatch");
invariant(topo.counts?.sea_edges === 23, "Declared sea edge count mismatch");
invariant(topo.counts?.ports === 16, "Declared port count mismatch");

console.log("Canonical map topology check: OK — 52 territories / 81 land / 23 sea / 16 ports");
