/**
 * Opt-in diagnostics switch for the renderer.
 *
 * Nothing is logged by default. To enable numeric audio diagnostics (sample rates, chunk durations,
 * RMS, noise floor - never audio samples and never transcript text unless explicitly requested), run in DevTools:
 *     localStorage.setItem('DEBUG_AUDIO', '1')      // then Start a new recording
 * and to switch off:
 *     localStorage.removeItem('DEBUG_AUDIO')
 */
export function isAudioDebugEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('DEBUG_AUDIO') === '1'
  } catch {
    return false
  }
}
