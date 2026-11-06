"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { signOut } from "@/lib/auth/actions";

/**
 * Runs the signOut Server Action. On success the action redirects to /login (the redirect is
 * re-thrown so Next.js performs it). Any other failure sets `failed` so the screen can say so.
 */
export function useSignOut() {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function run() {
    setFailed(false);
    startTransition(async () => {
      try {
        await signOut();
      } catch (error) {
        unstable_rethrow(error);
        setFailed(true);
      }
    });
  }

  return { pending, failed, run };
}
