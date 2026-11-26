import type { Server } from "node:http";

export interface HelperJiraConfig {
  baseUrl: string; token: string; auth: "basic" | "bearer"; email?: string; storyPointsField?: string;
}
export function parseEnv(text: string): Record<string, string>;
export function configFromEnv(env: Record<string, string | undefined>): HelperJiraConfig;
export function createJiraHelper(opts: { jira: HelperJiraConfig; origins: string[]; fetchImpl?: typeof fetch }): Server;
