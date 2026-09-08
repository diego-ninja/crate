import {
  createEqChain,
  isFlatGains,
  type EqChain,
  type EqGains,
} from "@/lib/equalizer";

export interface EqualizerHost {
  context?: AudioContext;
  setOutputChain?: (input: AudioNode | null, output: AudioNode | null) => void;
}

export interface EqualizerState {
  enabled: boolean;
  gains: EqGains;
}

let host: EqualizerHost | null = null;
let chain: EqChain | null = null;
let enabled = false;
let lastGains: EqGains = [];

export function setEqualizerHost(nextHost: EqualizerHost | null): void {
  host = nextHost;
}

export function getEqualizerState(): EqualizerState {
  return {
    enabled,
    gains: [...lastGains],
  };
}

function disposeChain(): void {
  if (!chain) return;
  host?.setOutputChain?.(null, null);
  chain.dispose();
  chain = null;
}

export function resetEqualizer(): void {
  disposeChain();
  enabled = false;
  lastGains = [];
}

/**
 * Enable/disable the post-processing equalizer and/or update its gains.
 * Safe to call at any time — no-op until the engine is initialised.
 *
 * When `enabled` is true and `gains` is non-flat, a BiquadFilter chain
 * is spliced between masterOut and destination via our vendored patch.
 * When disabled or flat, the chain is torn down so there is zero
 * processing overhead.
 */
export function setEqualizer(nextEnabled: boolean, gains: EqGains): void {
  if (!host?.setOutputChain || !host.context) return;

  enabled = nextEnabled;
  lastGains = [...gains];

  // If the user wants flat output, skip the chain entirely — biquads
  // at 0 dB aren't quite a no-op (minor numerical error) and why pay
  // for unused DSP.
  const shouldProcess = nextEnabled && !isFlatGains(gains);

  if (!shouldProcess) {
    disposeChain();
    return;
  }

  if (!chain) {
    chain = createEqChain(host.context);
    host.setOutputChain(chain.input, chain.output);
  }
  chain.setGains(gains);
}

/** True if the equalizer chain is currently spliced into the output. */
export function isEqualizerActive(): boolean {
  return enabled && chain !== null;
}
