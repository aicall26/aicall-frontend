/**
 * Credit state management - fetches from backend + caches.
 * Trimite update events ca header-ul + pagina call sa se actualizeze.
 */
import { api } from './api.js';

let cachedBalance = null;
const listeners = new Set();

export function onCreditChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try { fn(cachedBalance); } catch {}
  }
}

export async function fetchCredit() {
  try {
    cachedBalance = await api.get('/api/credit/balance');
    notify();
    return cachedBalance;
  } catch (e) {
    // Backend not deployed yet - returns null, UI hides credit display
    cachedBalance = null;
    notify();
    return null;
  }
}

export function getCachedCredit() {
  return cachedBalance;
}

export function setCreditFromTick(creditCents, minutesRemaining) {
  if (cachedBalance) {
    cachedBalance.credit_cents = creditCents;
    cachedBalance.credit_usd = Math.round(creditCents / 100 * 100) / 100;
    cachedBalance.minutes_with_translation = Math.floor(creditCents / 8);
  } else {
    cachedBalance = {
      credit_cents: creditCents,
      credit_usd: Math.round(creditCents / 100 * 100) / 100,
      minutes_with_translation: Math.floor(creditCents / 8),
      minutes_without_translation: Math.floor(creditCents / 3),
    };
  }
  notify();
}

export function formatCredit(balance) {
  if (!balance) return '';
  const dollars = (balance.credit_cents / 100).toFixed(2);
  return `$${dollars}`;
}

export function formatMinutes(balance, withTranslation = true) {
  if (!balance) return '';
  const m = withTranslation ? balance.minutes_with_translation : balance.minutes_without_translation;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}min` : `${h}h`;
}
