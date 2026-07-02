/**
 * Password hashing (auth plan §4.1, T-2): argon2id via @node-rs/argon2 (prebuilt
 * binaries — no node-gyp, builds clean in the Render Docker image). Params tuned for
 * ~50–100ms server cost (§11): OWASP-recommended 19 MiB memory, 2 iterations.
 */
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

const PARAMS = {
  // Algorithm.Argon2id — the const enum can't be imported under isolatedModules,
  // and argon2id is also the library default. Pinned numerically to be explicit.
  algorithm: 2,
  memoryCost: 19_456, // KiB (19 MiB)
  timeCost: 2,
  parallelism: 1,
};

export function hash(password: string): Promise<string> {
  return argonHash(password, PARAMS);
}

/** Constant-shape verify: any failure (malformed hash, wrong password) is just `false`. */
export async function verify(hashed: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hashed, password);
  } catch {
    return false;
  }
}
