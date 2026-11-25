import { describe, expect, it } from 'vitest';
import { PRESET_ARCHITECTURES } from '../ir/presets';
import { simulateRequestTrace } from '../simulator/requestTracer';
import { adapterRegistry } from '../adapters/registry';

describe('Middleware pipeline reordering', () => {
  it('executes middleware steps in reordered sequence during request simulation', () => {
    const ir = PRESET_ARCHITECTURES[0].createIR();
    const route = ir.routes['rt-orders-canary'];
    // Attach WAF ruleset after Rate Limiting
    route.middlewares.push({
      id: 'mw-waf-test',
      pluginId: 'waf-ruleset',
      enabled: true,
      config: { mode: 'block', paranoiaLevel: 2, blockSqlInjection: true, blockXss: true },
    });

    const baseReq = {
      method: 'GET' as const,
      protocol: 'HTTPS' as const,
      host: 'api.acme.internal',
      path: '/v2/orders',
      headers: { 'X-Session-ID': 'sess-1' },
      authToken: 'Bearer eyJ.valid.sig',
      clientIp: '203.0.113.10',
      clientCertPresent: true,
      sourceRegion: 'us-east' as const,
      payloadSample: '{"ok":true}',
    };

    const chaos = {
      force503Upstreams: {},
      latencySpikesMs: {},
      forceExpiredCerts: {},
      droppedRegion: null,
    };

    const traceBefore = simulateRequestTrace(ir, baseReq, chaos, 1);
    const mwBefore = traceBefore.steps
      .filter((s) => s.stage === 'Middleware Chain')
      .map((s) => s.title);

    expect(mwBefore[0]).toContain('Rate Limiting');
    expect(mwBefore[mwBefore.length - 1]).toContain('WAF Ruleset');

    // Move WAF Ruleset to index 0 (before Rate Limiting)
    const [waf] = route.middlewares.splice(route.middlewares.length - 1, 1);
    route.middlewares.unshift(waf);

    const traceAfter = simulateRequestTrace(ir, baseReq, chaos, 2);
    const mwAfter = traceAfter.steps
      .filter((s) => s.stage === 'Middleware Chain')
      .map((s) => s.title);

    expect(mwAfter[0]).toContain('WAF Ruleset');
    expect(mwAfter[1]).toContain('Rate Limiting');

    // Verify compiler reflects updated pipeline order
    const envoyOutput = adapterRegistry.get('envoy-xds')?.compile(ir) ?? '';
    expect(envoyOutput.indexOf('waf-ruleset')).toBeLessThan(envoyOutput.indexOf('rate-limit'));
  });
});
