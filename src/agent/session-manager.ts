import crypto from "node:crypto";
import { manualSessionId } from "../utils/time.js";

export type SessionState = "idle" | "starting" | "running" | "stopping" | "stopped" | "error";

export type Session = {
  sessionId: string;
  ingestToken: string;
  state: SessionState;
  tabUrl: string;
  debugPort: number;
  startedAt: string;
  attachedTargetUrl?: string;
};

export class SessionManager {
  private active: Session | null = null;

  getActive(): Session | null {
    return this.active;
  }

  startStarting(tabUrl: string, debugPort: number): Session {
    if (this.active && ["starting", "running"].includes(this.active.state)) {
      throw new Error("SESSION_ALREADY_RUNNING");
    }

    const session: Session = {
      sessionId: crypto.randomUUID(),
      ingestToken: crypto.randomBytes(24).toString("base64url"),
      state: "starting",
      tabUrl,
      debugPort,
      startedAt: new Date().toISOString(),
    };

    this.active = session;
    return session;
  }

  markRunning(attachedTargetUrl: string): Session {
    if (!this.active) {
      throw new Error("SESSION_NOT_FOUND");
    }
    this.active.state = "running";
    this.active.attachedTargetUrl = attachedTargetUrl;
    return this.active;
  }

  markError(): void {
    if (this.active) {
      this.active.state = "error";
    }
  }

  stop(sessionId: string): Session {
    if (!this.active || this.active.sessionId !== sessionId) {
      throw new Error("SESSION_NOT_FOUND");
    }

    this.active.state = "stopped";
    const stopped = this.active;
    this.active = null;
    return stopped;
  }

  resolveSessionId(explicitSessionId?: string): string {
    if (explicitSessionId) {
      return explicitSessionId;
    }

    if (this.active) {
      return this.active.sessionId;
    }

    return manualSessionId();
  }

  validateIngest(sessionId: string, ingestToken: string): boolean {
    if (!this.active) {
      return false;
    }

    if (this.active.sessionId !== sessionId) {
      return false;
    }

    return this.active.ingestToken === ingestToken;
  }
}
