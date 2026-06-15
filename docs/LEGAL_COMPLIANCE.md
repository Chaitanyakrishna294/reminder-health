# Legal Compliance Status — Re-MIND-eЯ

Mapped against the Vibecoding Legal Guide (v1.0, 2026). Reviewed 2026-06-15.
Re-MIND-eЯ is a **web app / PWA** (Next.js on Vercel) plus a Telegram bot — it is **not** in
the Apple/Google app stores, has **no payments**, sends **transactional email only**, and has
**no AI-generated content** feature. That makes several sections N/A or future-only (noted below).

> This file tracks engineering status. It is **not legal advice** — have the policies and the
> governing-law clause reviewed by a qualified attorney before relying on them.

## Status by section

| # | Section | Status | Notes |
|---|---------|--------|-------|
| 1 | Terms of Service | ✅ Done | `/terms` — permitted/acceptable use, liability disclaimer, termination, right to modify, user-content clause, fees/refunds, **governing law & disputes** (placeholder jurisdiction), eligibility/age. |
| 2 | Privacy Policy | ✅ Done | `/privacy` — data inventory, purpose, third-party disclosure, retention, user rights, children's privacy, contact. **Linked from** signup checkbox, login footer, Settings, and cookie banner. |
| 3 | IP & Trademark | ⚠️ Your action | Code/asset licensing is clean (see below). **You must** run trademark searches and consider registering the mark. |
| 4 | Data Declaration / App Store | ➖ N/A now | Not store-distributed. EU consent banner ✅. No analytics/ad SDKs, no camera/location. Revisit if you publish to App/Play stores. |
| 5 | User Data Security | ✅ Done | HTTPS+HSTS, Supabase encryption at rest, bcrypt password hashing (Supabase Auth), RLS access control. Breach plan below. |
| 6 | Payment Compliance | ➖ Future | No payments yet. When monetizing: use Stripe/Razorpay/Paddle, add refund policy (already stubbed in ToS §6), VAT if applicable. |
| 7 | Children's Privacy (COPPA) | ✅ Done | 18+ age affirmation checkbox at registration; "not for under-13" stated in ToS §3 and Privacy §7. |
| 8 | Email Marketing | ➖ N/A now | Only transactional email (verification, magic link, password reset) — exempt. Add opt-in + unsubscribe before any newsletter. |
| 9 | AI-Generated Content | ➖ N/A | No AI/LLM content generation in the product. Revisit if an AI feature is added. |
| 10 | Accessibility (WCAG/ADA) | ⚠️ Partial | React escaping, semantic buttons, alt text present, security headers. Run Lighthouse/Axe and fix contrast/ARIA gaps before claiming AA. |

## Asset & code licensing (section 3)

- **Fonts:** Inter & JetBrains Mono via `next/font/google` — OFL, free for commercial use.
- **Icons:** `lucide-react` — ISC licence.
- **Key deps:** Next.js (MIT), React (MIT), Supabase JS (MIT), recharts (MIT), zod (MIT),
  moment-timezone (MIT). No GPL/copyleft snippets identified in app code.

## Breach-notification & incident-response plan (section 5)

1. **Contain:** rotate `SUPABASE_SERVICE_ROLE_KEY` and any exposed keys; revoke suspicious sessions.
2. **Assess:** identify what data and which users were affected (Supabase logs, audit_logs).
3. **Notify:** under GDPR, report to the supervisory authority within **72 hours** of becoming
   aware; notify affected users without undue delay if high risk.
4. **Remediate & record:** patch root cause, document timeline and actions taken.
5. **Access hygiene:** periodically review who has Supabase/Vercel/GitHub production access and
   revoke stale access.

## Your remaining (non-code) to-dos

- [ ] Replace `[your-contact-email]` in `/privacy` and `/terms`, and the `[your country/state]`
      governing-law placeholder in `/terms` §9.
- [ ] Have the privacy policy + terms reviewed by counsel (you handle **health data** — higher bar).
- [ ] Trademark: search USPTO/IP-India + App/Play stores + domain/social handles; register if traction.
- [ ] Activate CAPTCHA: set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Vercel) + secret (Supabase Auth).
- [ ] If/when you add payments: pick a compliant processor, add refund terms, handle VAT.
- [ ] Run Lighthouse/Axe accessibility audit and close any AA gaps.
- [ ] If you publish to App/Play stores: complete Apple Privacy Nutrition Label + Google Data Safety form.
