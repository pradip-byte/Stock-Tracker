import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

export function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
  return v;
}
