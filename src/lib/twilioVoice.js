/**
 * Wrapper Twilio Voice SDK - apel telefonic real prin browser.
 *
 * Fluxul:
 * 1. setupDevice(): cere token de la backend, init Twilio Device
 * 2. makeCall(toNumber, useTranslation): porneste apel
 * 3. hangup(): inchide apel
 *
 * Daca backend-ul/Twilio nu e configurat, isAvailable() returneaza false
 * si pagina call.js cade pe simulare.
 */
import { api, HAS_BACKEND } from './api.js';

let Device = null;
let device = null;
let activeCall = null;
let setupPromise = null;

async function loadSDK() {
  if (Device) return Device;
  try {
    const mod = await import('@twilio/voice-sdk');
    Device = mod.Device;
    return Device;
  } catch (e) {
    console.warn('Twilio Voice SDK not installed yet:', e);
    return null;
  }
}

async function fetchToken() {
  const res = await api.get('/api/twilio/token');
  return res.token;
}

export async function setupDevice() {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    const SDK = await loadSDK();
    if (!SDK) return null;
    if (!HAS_BACKEND) return null;

    try {
      const token = await fetchToken();
      device = new SDK(token, {
        logLevel: 'warn',
        codecPreferences: ['opus', 'pcmu'],
      });

      device.on('error', (err) => {
        console.error('Twilio Device error:', err);
      });

      device.on('tokenWillExpire', async () => {
        try {
          const fresh = await fetchToken();
          device.updateToken(fresh);
        } catch (e) {
          console.error('Token refresh failed:', e);
        }
      });

      await device.register();
      return device;
    } catch (e) {
      console.error('Twilio setup failed:', e);
      device = null;
      return null;
    }
  })();
  return setupPromise;
}

export function isAvailable() {
  return !!device;
}

export async function makeCall(toNumber, params = {}) {
  if (!device) {
    const d = await setupDevice();
    if (!d) throw new Error('Twilio Device not available');
  }
  activeCall = await device.connect({
    params: { To: toNumber, ...params },
  });
  return activeCall;
}

export function getActiveCall() {
  return activeCall;
}

export function hangup() {
  if (activeCall) {
    try { activeCall.disconnect(); } catch {}
    activeCall = null;
  }
}

export function muteCall(muted) {
  if (activeCall) {
    try { activeCall.mute(muted); } catch {}
  }
}

export function sendDigit(digit) {
  if (!activeCall) return;
  try { activeCall.sendDigits(String(digit)); } catch (e) {
    console.warn('sendDigits failed:', e);
  }
}

export async function answerIncoming(call) {
  activeCall = call;
  call.accept();
  return call;
}

export function rejectIncoming(call) {
  try { call.reject(); } catch {}
}

export function onIncomingCall(handler) {
  if (!device) return () => {};
  const wrapped = (call) => handler(call);
  device.on('incoming', wrapped);
  return () => device.off('incoming', wrapped);
}

export function destroy() {
  hangup();
  if (device) {
    try { device.destroy(); } catch {}
    device = null;
  }
  setupPromise = null;
}
