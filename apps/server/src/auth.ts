import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { ApiError, one, type AuthStrategy, type Ctx, type User } from '@yardline/api';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };
const COOKIE = 'yl_session';
const SESSION_DAYS = 7;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const USER_SQL = 'SELECT u.id, u.name, u.email, u.title, u.role, u.branch_id AS "branchId" FROM users u';

/**
 * Email + password sign-in with an opaque session token in an HttpOnly, SameSite=Lax cookie.
 * Only the token's SHA-256 is stored. SameSite=Lax keeps the cookie off cross-site POSTs.
 */
export function sessionAuth(opts: { secureCookies: boolean }): AuthStrategy {
  return {
    async user(c, ctx) {
      const token = getCookie(c, COOKIE);
      if (!token) return null;
      const u = await one<User>(ctx.db, `${USER_SQL} JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > $2`, [sha256(token), ctx.now().toISOString()]);
      return u ?? null;
    },
    mount(app, ctx: Ctx) {
      app.post('/session', async (c) => {
        const parsed = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) throw new ApiError(400, 'invalid', 'Email and password are required');
        const row = await one<User & { password_hash: string | null }>(ctx.db, `${USER_SQL.replace('u.branch_id AS "branchId"', 'u.branch_id AS "branchId", u.password_hash')} WHERE lower(u.email) = lower($1)`, [parsed.data.email]);
        const ok = row?.password_hash ? await verifyPassword(parsed.data.password, row.password_hash) : false;
        if (!row || !ok) throw new ApiError(401, 'bad_credentials', 'Wrong email or password');
        const token = randomBytes(32).toString('base64url');
        const expires = new Date(ctx.now().getTime() + SESSION_DAYS * 86_400_000);
        await ctx.db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha256(token), row.id, expires.toISOString()]);
        setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: opts.secureCookies, path: '/', expires });
        const { password_hash: _drop, ...user } = row;
        return c.json(user);
      });
      app.delete('/session', async (c) => {
        const token = getCookie(c, COOKIE);
        if (token) await ctx.db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
        deleteCookie(c, COOKIE, { path: '/' });
        return c.body(null, 204);
      });
    },
  };
}
