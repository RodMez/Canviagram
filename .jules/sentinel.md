## 2024-10-08 - [Timing Attack in Secret Comparison]
**Vulnerability:** The API endpoint `app/api/reminders/run/route.ts` compared the provided `x-reminder-sweep-secret` header against the expected secret (`env.REMINDER_SWEEP_SECRET`) using a simple string equality check (`!==`).
**Learning:** Simple string equality comparison (`===` or `!==`) returns early upon finding the first mismatched character. This allows attackers to deduce the secret character by character by measuring the response time, which is known as a timing attack.
**Prevention:** Use a timing-safe equality comparison function, such as `timingSafeEqual` from the `crypto` module (Node.js standard library), which compares strings in constant time. Make sure to check the lengths first before passing the buffers to `timingSafeEqual`, as it throws an error if lengths do not match.

## 2024-11-07 - [Timing Attack in Login Password Comparison]
**Vulnerability:** The API endpoint `app/api/auth/login/route.ts` mitigated timing attacks for non-existent users by comparing a dummy hash (`$2a$10$dummyhashdummyhashdummyhashdummyha`) with the user's password.
**Learning:** `bcrypt.compare` parses the bcrypt hash string first and fails instantly if the characters are invalid according to its internal format constraint. This instantaneous fail re-introduces the timing side-channel oracle since non-existent user requests are significantly faster (~0ms) compared to existing user requests (~100ms) with wrong passwords.
**Prevention:** Ensure dummy hashes used for timing mitigations are actually structurally and mathematically valid bcrypt hashes (even if the string is just randomly generated valid characters).
