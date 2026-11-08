## 2024-10-08 - [Timing Attack in Secret Comparison]
**Vulnerability:** The API endpoint `app/api/reminders/run/route.ts` compared the provided `x-reminder-sweep-secret` header against the expected secret (`env.REMINDER_SWEEP_SECRET`) using a simple string equality check (`!==`).
**Learning:** Simple string equality comparison (`===` or `!==`) returns early upon finding the first mismatched character. This allows attackers to deduce the secret character by character by measuring the response time, which is known as a timing attack.
**Prevention:** Use a timing-safe equality comparison function, such as `timingSafeEqual` from the `crypto` module (Node.js standard library), which compares strings in constant time. Make sure to check the lengths first before passing the buffers to `timingSafeEqual`, as it throws an error if lengths do not match.

## 2024-10-09 - [Timing Attack Mitigation Efficacy in Auth Flows]
**Vulnerability:** The API endpoint `app/api/auth/login/route.ts` used an invalid dummy hash string (`$2a$10$dummyhashdummyhashdummyhashdummyha`) in an attempt to equalize comparison time for invalid vs valid users. However, `bcryptjs` fails instantly on improperly formatted hashes, circumventing the intended timing attack mitigation.
**Learning:** For timing mitigations that attempt to do fake hash comparisons with `bcrypt` (or similar tools), the dummy string MUST be a structurally and mathematically valid hash. Otherwise, the parsing step fails immediately, restoring the timing side channel because the operation returns too quickly.
**Prevention:** Always generate a real valid hash of a known static string (like 'dummy') and use that real valid hash string as your dummy hash when doing time-equalization logic.
