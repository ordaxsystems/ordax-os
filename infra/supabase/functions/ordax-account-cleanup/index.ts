import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ACCOUNT_CLEANUP_WORKER_ENABLED = false;
const MAX_CLOSES_PER_RUN = 10;
const MAX_JOBS_PER_CLOSE = 50;
const LEASE_SECONDS = 120;
const DEFAULT_USER_BUCKET = "ordax-user-data";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, value: unknown) {
  return new Response(JSON.stringify(value) + "\n", {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "pragma": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}

function error(status: number, code: string) {
  return json(status, { error: code });
}

function routePath(url: URL) {
  const marker = "/ordax-account-cleanup";
  const index = url.pathname.indexOf(marker);
  if (index >= 0) {
    const rest = url.pathname.slice(index + marker.length);
    return rest || "/";
  }
  return url.pathname;
}

function config() {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceRole = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const workerToken = (Deno.env.get("ORDAX_ACCOUNT_CLEANUP_WORKER_TOKEN") ?? "").trim();
  const userBucket = (Deno.env.get("ORDAX_USER_STORAGE_BUCKET") ?? DEFAULT_USER_BUCKET).trim();
  if (!url || !serviceRole || workerToken.length < 32 || !userBucket) {
    throw new Error("worker-unconfigured");
  }
  return { url, serviceRole, workerToken, userBucket };
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function secretEqual(a: string, b: string) {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }
  return diff === 0;
}

function adminClient(url: string, serviceRole: string) {
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function asRows(data: unknown) {
  return Array.isArray(data) ? data.filter((item) => item && typeof item === "object") as Record<string, unknown>[] : [];
}

function exactUuid(value: unknown) {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function boundedInt(value: unknown, min: number, max: number) {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : null;
}

async function finishJob(
  admin: ReturnType<typeof adminClient>,
  cleanupId: string,
  leaseToken: string,
  deleted: boolean,
  errorCode: string | null,
) {
  const { data, error: rpcError } = await admin.rpc("ordax_finish_account_close_cleanup_v1", {
    p_cleanup_id: cleanupId,
    p_lease_token: leaseToken,
    p_deleted: deleted,
    p_error_code: errorCode,
  });
  return !rpcError && data === true;
}

async function removeProviderObject(
  admin: ReturnType<typeof adminClient>,
  userBucket: string,
  job: Record<string, unknown>,
) {
  const cleanupId = exactUuid(job.cleanup_id);
  const leaseToken = exactUuid(job.lease_token);
  const provider = typeof job.provider === "string" ? job.provider : "";
  const bucket = typeof job.provider_bucket === "string" ? job.provider_bucket : "";
  const objectKey = typeof job.provider_object_key === "string" ? job.provider_object_key : "";

  if (!cleanupId || !leaseToken || !objectKey || objectKey.startsWith("/") || objectKey.includes("../")) {
    return { attempted: false, reconciled: false };
  }

  if (provider !== "supabase-storage") {
    return {
      attempted: true,
      reconciled: await finishJob(admin, cleanupId, leaseToken, false, "unsupported-provider"),
    };
  }
  if (bucket !== userBucket) {
    return {
      attempted: true,
      reconciled: await finishJob(admin, cleanupId, leaseToken, false, "provider-bucket-mismatch"),
    };
  }

  // Supabase Storage deletion must go through the Storage API. Direct SQL deletion
  // of storage metadata can orphan physical bytes, so it is deliberately absent.
  const { error: removeError } = await admin.storage.from(userBucket).remove([objectKey]);
  if (removeError) {
    return {
      attempted: true,
      reconciled: await finishJob(admin, cleanupId, leaseToken, false, "provider-delete-failed"),
    };
  }
  return {
    attempted: true,
    reconciled: await finishJob(admin, cleanupId, leaseToken, true, null),
  };
}

async function identityPresent(admin: ReturnType<typeof adminClient>, subjectUserId: string) {
  const { data, error: lookupError } = await admin.auth.admin.getUserById(subjectUserId);
  if (!lookupError && data.user) return true;
  if (lookupError) {
    const raw = lookupError as unknown as { status?: unknown; code?: unknown };
    const status = Number(raw.status);
    const code = typeof raw.code === "string" ? raw.code : "";
    if (status === 404 || code === "user_not_found") return false;
    throw new Error("identity-lookup-failed");
  }
  return false;
}

Deno.serve(async (req: Request) => {
  const path = routePath(new URL(req.url));
  if (path === "/health" && req.method === "GET") {
    return json(200, {
      status: "ok",
      service: "ordax-account-cleanup",
      version: 1,
      enabled: ACCOUNT_CLEANUP_WORKER_ENABLED,
      maxClosesPerRun: MAX_CLOSES_PER_RUN,
      maxJobsPerClose: MAX_JOBS_PER_CLOSE,
    });
  }
  if (path !== "/run" || req.method !== "POST") {
    return error(404, "worker-route-not-found");
  }
  if (!ACCOUNT_CLEANUP_WORKER_ENABLED) {
    return error(503, "account-cleanup-worker-disabled");
  }

  let worker;
  try {
    worker = config();
  } catch {
    return error(503, "account-cleanup-worker-unconfigured");
  }
  const supplied = (req.headers.get("x-ordax-worker-token") ?? "").trim();
  if (!supplied || !(await secretEqual(supplied, worker.workerToken))) {
    return error(401, "worker-authentication-required");
  }

  const admin = adminClient(worker.url, worker.serviceRole);
  const { data: workData, error: workError } = await admin.rpc(
    "ordax_list_account_close_work_v1",
    { p_limit: MAX_CLOSES_PER_RUN },
  );
  if (workError) return error(503, "account-cleanup-work-unavailable");

  let processedCloses = 0;
  let attemptedDeletes = 0;
  let reconciledJobs = 0;
  let closedAccounts = 0;
  let deferredAccounts = 0;

  for (const work of asRows(workData)) {
    const closeId = exactUuid(work.close_id);
    const subjectUserId = exactUuid(work.subject_user_id);
    const due = boundedInt(work.due_cleanup_count, 0, 1000000);
    const authFenceReady = work.auth_fence_ready === true;
    if (!closeId || !subjectUserId || due === null) continue;
    processedCloses += 1;

    if (due > 0) {
      const { data: claimData, error: claimError } = await admin.rpc(
        "ordax_claim_account_close_cleanup_v1",
        {
          p_close_id: closeId,
          p_limit: MAX_JOBS_PER_CLOSE,
          p_lease_seconds: LEASE_SECONDS,
        },
      );
      if (claimError) {
        deferredAccounts += 1;
        continue;
      }
      for (const job of asRows(claimData)) {
        const result = await removeProviderObject(admin, worker.userBucket, job);
        if (result.attempted) attemptedDeletes += 1;
        if (result.reconciled) reconciledJobs += 1;
      }
    }

    const { data: verifyData, error: verifyError } = await admin.rpc(
      "ordax_verify_account_close_cleanup_v1",
      { p_close_id: closeId, p_subject_user_id: subjectUserId },
    );
    const verification = asRows(verifyData)[0] ?? null;
    if (verifyError || !verification || verification.ready_for_identity_delete !== true || !authFenceReady) {
      deferredAccounts += 1;
      continue;
    }

    try {
      if (await identityPresent(admin, subjectUserId)) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(subjectUserId);
        if (deleteError) {
          deferredAccounts += 1;
          continue;
        }
      }
    } catch {
      deferredAccounts += 1;
      continue;
    }

    const { data: markData, error: markError } = await admin.rpc(
      "ordax_mark_account_closed_v1",
      { p_close_id: closeId, p_subject_user_id: subjectUserId },
    );
    if (!markError && markData === true) {
      closedAccounts += 1;
    } else {
      deferredAccounts += 1;
    }
  }

  return json(200, {
    processedCloses,
    attemptedDeletes,
    reconciledJobs,
    closedAccounts,
    deferredAccounts,
  });
});
