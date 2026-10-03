# NAVI Architecture Principles

## Principle 1 — One Responsibility Per Layer

```
Editor
    ↓
Compiler
    ↓
Publisher
    ↓
Loader
    ↓
Runtime
```

Each layer has one responsibility. No layer crosses into another's domain.

---

## Principle 2 — Typed Boundaries

Every layer communicates through immutable typed contracts. Internal implementation details never leak across boundaries.

---

## Principle 3 — Infrastructure Independence

Infrastructure never depends on runtime capabilities. Capabilities may depend on infrastructure.

```
Compiler
Publisher
Loader

    ↓

Runtime Services

    ↓

Applications
```

Never the reverse. The compiler, publisher, and loader have no knowledge of routing, search, or positioning.

---

## Principle 4 — Stateless Infrastructure

The compiler, publisher, and loader remain stateless. All state lives in `LoadedPackage` and `RuntimeEngine`.

---

## Principle 5 — Fail Early

Verification happens before consumption. Package validation, checksum verification, and reference integrity checks all happen during loading, not during route computation.

---

## Principle 6 — Stable Public APIs

Public contracts are frozen after their milestone. Implementations may change freely behind stable interfaces.

---

## Principle 7 — Capability Façade

Runtime capabilities are exposed as services, not engines. `RuntimeEngine` presents a unified API (`engine.findRoute(...)`, `engine.search(...)`, `engine.getBuilding(...)`). Internal engines (A*, search trie, spatial index) are implementation details invisible to consumers.

---

## Principle 8 — Build Capabilities, Not Infrastructure

Infrastructure exists to enable capabilities. Before introducing a new infrastructure layer, ask whether the problem can be solved by extending an existing capability. New infrastructure requires a clear architectural justification.

---

## Principle 9 — Closed Infrastructure, Open Capabilities

Infrastructure (Compiler, Publisher, Loader, Runtime pipeline) is closed for modification after stabilization. New functionality is added by introducing or extending runtime capabilities rather than altering infrastructure. Changes to infrastructure require demonstrating that the existing architecture cannot support the capability through extension alone.
