# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AiCall is a B2B real-time voice translation call system. This repo is the **frontend only** — built with Vite + vanilla JS (no React/framework). All UI text is in professional Romanian.

## Commands

- `npm run dev` — Start dev server
- `npm run build` — Production build (output: `dist/`)
- `npm run preview` — Preview production build

## Architecture

**SPA with hash-based routing** via `src/lib/router.js`. Each page follows a `render()` + `mount()` pattern:
- `render()` returns an HTML string
- `mount()` attaches event listeners after DOM insertion

### Key files

- `src/main.js` — Entry point, Supabase auth check, theme restore, email confirmation handling
- `src/lib/router.js` — App shell (header with dropdown menu, tab bar, page switching), exports `renderApp()` and `navigateAndCall()`
- `src/lib/supabase.js` — Supabase client init from env vars
- `src/lib/api.js` — Fetch wrapper with auto Bearer token from Supabase session
- `src/pages/login.js` — Login/register with password toggle, email confirmation success page, Romanian error messages
- `src/pages/call.js` — Dialpad, language selector (RO/EN/DE/FR/ES), ringtone via Web Audio API, 3-second countdown, call simulation (ready for real API)
- `src/pages/contacts.js` — CRUD contacts via Supabase, Contact Picker API import, search
- `src/pages/history.js` — Call history from Supabase `call_history` table
- `src/pages/voice.js` — Voice cloning: MediaRecorder + Web Speech API for word-by-word validation with green/red highlighting, upload to ElevenLabs API, save voice_id to Supabase
- `src/pages/profile.js` — User profile, change password, theme toggle
- `src/style.css` — All styles with dark/light theme via CSS custom properties

### External services

- **Supabase**: Auth (email+password), database (tables: `users`, `contacts`, `call_history`)
- **ElevenLabs**: Voice cloning API (key: `VITE_ELEVENLABS_API_KEY`)
- **Backend API** (optional): `VITE_API_URL` for real phone calls via Twilio

## Deployment

- Deployed to **Vercel** via GitHub Actions (`.github/workflows/deploy.yml`)
- Config in `vercel.json`: framework "vite", SPA rewrites
- GitHub repo: Bosanci26/aicall-frontend

## Conventions

- All UI text in professional Romanian
- Dark theme is default, user preference persisted in `localStorage` key `aicall-theme`
- Target language preference persisted in `localStorage` key `aicall-target-lang`
- No React, no TypeScript — vanilla JS only
- Mobile-first design, max-width 480px
