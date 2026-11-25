import { describe, expect, it } from "vitest";
import {
  BinaryDiffInputError,
  computePlanDigest,
  computeStateEtag,
  computeUnifiedDiff,
} from "../store.ts";
import type { ActiveIngressRoute } from "../../src/shared/contracts.ts";

function makeRoute(overrides: Partial<ActiveIngressRoute> = {}): ActiveIngressRoute {
  return {
    routeId: "route-a",
    appName: "payments-api",
    environment: "staging",
    hostname: "payments.staging.example.com",
    pathPrefix: "/v1/payments",
    backendService: "payments-svc",
    backendPort: 8443,
    exposure: "external",
    tlsProfile: "tls_1_3_strict",
    wafEnabled: true,
    gatewayName: "shared-gateway",
    canaryWeight: 0,
    revisionNote: "",
    updatedAt: "2026-11-24T00:00:00.000Z",
    ...overrides,
  };
}

function getShortLineSequences(maxLength: number): string[][] {
  const sequences: string[][] = [[]];
  for (let length = 1; length <= maxLength; length++) {
    for (let mask = 0; mask < 2 ** length; mask++) {
      sequences.push(
        Array.from({ length }, (_, index) => ((mask >> index) & 1 ? "b" : "a"))
      );
    }
  }
  return sequences;
}

describe("computeStateEtag", () => {
  it("is stable across 50 unchanged snapshots with volatile update timestamps", () => {
    const route = makeRoute();
    const expectedEtag = computeStateEtag([route]);

    for (let snapshot = 0; snapshot < 50; snapshot++) {
      expect(
        computeStateEtag([
          { ...route, updatedAt: `2026-11-24T00:00:${String(snapshot).padStart(2, "0")}.000Z` },
        ])
      ).toBe(expectedEtag);
    }
  });

  it("canonicalizes route order without mutating input and changes for meaningful state", () => {
    const routes = [makeRoute({ routeId: "route-b" }), makeRoute({ routeId: "route-a" })];
    const originalOrder = routes.map((route) => route.routeId);
    const expectedEtag = computeStateEtag(routes);

    expect(computeStateEtag([...routes].reverse())).toBe(expectedEtag);
    expect(routes.map((route) => route.routeId)).toEqual(originalOrder);
    expect(computeStateEtag([{ ...routes[0], backendPort: 8444 }, routes[1]])).not.toBe(
      expectedEtag
    );
  });
});

describe("computePlanDigest", () => {
  it("canonicalizes artifact order and binds the target ETag and rollback content", () => {
    const artifacts = {
      "terraform/edge.tf": "resource { value = 1 }",
      "k8s/route.yaml": "kind: HTTPRoute",
    };
    const rollbackArtifacts = {
      "k8s/route.yaml": "kind: HTTPRoute\nweight: 0",
      "terraform/edge.tf": "resource { value = 0 }",
    };
    const expectedDigest = computePlanDigest("etag-v1", artifacts, rollbackArtifacts);

    expect(
      computePlanDigest(
        "etag-v1",
        Object.fromEntries(Object.entries(artifacts).reverse()),
        Object.fromEntries(Object.entries(rollbackArtifacts).reverse())
      )
    ).toBe(expectedDigest);
    expect(computePlanDigest("etag-v2", artifacts, rollbackArtifacts)).not.toBe(expectedDigest);
    expect(
      computePlanDigest(
        "etag-v1",
        { ...artifacts, "k8s/route.yaml": "changed" },
        rollbackArtifacts
      )
    ).not.toBe(expectedDigest);
    expect(
      computePlanDigest("etag-v1", artifacts, { ...rollbackArtifacts, "k8s/route.yaml": "changed" })
    ).not.toBe(expectedDigest);
  });
});

describe("computeUnifiedDiff", () => {
  it("preserves unchanged lines after an insertion", () => {
    const diff = computeUnifiedDiff(
      "routes.yaml",
      "HTTPRoute",
      "alpha\nbeta\ngamma",
      "alpha\ninserted\nbeta\ngamma"
    );

    expect(diff.unifiedDiff).toBe(
      "--- a/routes.yaml\n+++ b/routes.yaml\n@@ -1,3 +1,4 @@\n alpha\n+inserted\n beta\n gamma"
    );
    expect(diff.linesAdded).toBe(1);
    expect(diff.linesRemoved).toBe(0);
  });

  it("counts replacement and empty-document changes without phantom lines", () => {
    const replacement = computeUnifiedDiff("routes.yaml", "HTTPRoute", "old", "new");
    const addition = computeUnifiedDiff("routes.yaml", "HTTPRoute", "", "new");
    const deletion = computeUnifiedDiff("routes.yaml", "HTTPRoute", "old", "");

    expect(replacement).toMatchObject({ linesAdded: 1, linesRemoved: 1 });
    expect(addition).toMatchObject({ linesAdded: 1, linesRemoved: 0 });
    expect(deletion).toMatchObject({ linesAdded: 0, linesRemoved: 1 });
    expect(addition.unifiedDiff).toContain("@@ -0,0 +1,1 @@");
    expect(deletion.unifiedDiff).toContain("@@ -1,1 +0,0 @@");
  });

  it("rejects NUL-containing content instead of rendering a text diff", () => {
    expect(() => computeUnifiedDiff("routes.bin", "Binary", "before\0binary", "after")).toThrow(
      BinaryDiffInputError
    );
    expect(() => computeUnifiedDiff("routes.bin", "Binary", "before", "after\0binary")).toThrow(
      BinaryDiffInputError
    );
  });

  it("reconstructs both inputs for short repeated-line combinations", () => {
    const sequences = getShortLineSequences(3);

    for (const before of sequences) {
      for (const after of sequences) {
        const diff = computeUnifiedDiff("routes.yaml", "HTTPRoute", before.join("\n"), after.join("\n"));
        const operations = diff.unifiedDiff.split("\n").slice(3);

        expect(
          operations.filter((line) => !line.startsWith("+")).map((line) => line.slice(1))
        ).toEqual(before);
        expect(
          operations.filter((line) => !line.startsWith("-")).map((line) => line.slice(1))
        ).toEqual(after);
      }
    }
  });

  it("falls back to a complete replacement when edit distance exceeds the bound", () => {
    const before = Array.from({ length: 257 }, (_, index) => `old-${index}`).join("\n");
    const after = Array.from({ length: 257 }, (_, index) => `new-${index}`).join("\n");
    const diff = computeUnifiedDiff("routes.yaml", "HTTPRoute", before, after);

    expect(diff).toMatchObject({ linesAdded: 257, linesRemoved: 257 });
    expect(diff.unifiedDiff).toContain("@@ -1,257 +1,257 @@");
  });
});
