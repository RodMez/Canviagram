## 2024-10-08 - [Timing Attack in Secret Comparison]
**Vulnerability:** The API endpoint `app/api/reminders/run/route.ts` compared the provided `x-reminder-sweep-secret` header against the expected secret (`env.REMINDER_SWEEP_SECRET`) using a simple string equality check (`!==`).
**Learning:** Simple string equality comparison (`===` or `!==`) returns early upon finding the first mismatched character. This allows attackers to deduce the secret character by character by measuring the response time, which is known as a timing attack.
**Prevention:** Use a timing-safe equality comparison function, such as `timingSafeEqual` from the `crypto` module (Node.js standard library), which compares strings in constant time. Make sure to check the lengths first before passing the buffers to `timingSafeEqual`, as it throws an error if lengths do not match.

## 2024-10-09 - [Timing Attack in Bcrypt Compare]
**Vulnerability:** The API endpoint `app/api/auth/login/route.ts` mitigated timing attacks for missing users by comparing the password against a dummy hash: `'$2a$10$dummyhashdummyhashdummyhashdummyha'`.
**Learning:** The dummy hash was an invalid bcrypt hash. Bcrypt's `compare` function fails instantly (0 ms) when provided with an invalid hash format or base64 encoding, while validating a correct hash format takes longer (~100 ms). Attackers could measure the response time to enumerate existing users.
**Prevention:** Always use a valid bcrypt hash string for dummy comparisons to ensure the timing is consistent with checking an actual user's password.
