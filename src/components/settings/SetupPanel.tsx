"use client";

// The setup flow: a to-do list computed from what actually exists, with a link
// on every line that goes to the thing that fixes it. It is a tab in Settings
// and a banner on the Inbox until the blocking items are done.

import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { usePolling } from "@/lib/ui/api";
import { Card, CardHead, Meter, Pill, StaleNotice } from "@/components/ui/primitives";
import type { SetupSummary } from "@/lib/fleet/setup-status";

export function useSetup() {
  return usePolling<SetupSummary>("/api/setup", 60000);
}

export function SetupPanel() {
  const setup = useSetup();
  const data = setup.data;

  if (!data) {
    return (
      <Card>
        <div className="card-body t-sm dimmer">{setup.error ?? "Checking what is configured…"}</div>
      </Card>
    );
  }

  const outstanding = data.checks.filter((c) => !c.done);

  return (
    <div className="stack">
      <StaleNotice error={setup.error} onRetry={() => void setup.refresh()} />

      <Card>
        <CardHead
          title="Setup"
          subtitle={
            data.ready
              ? "The essentials are in place. The rest unlocks more of the product."
              : "Two things gate everything else. The rest are strong recommendations."
          }
          right={
            <Pill tone={data.ready ? "ok" : "warn"}>
              {data.done} of {data.total} done
            </Pill>
          }
        />
        <div className="card-body">
          <Meter value={(data.done / data.total) * 100} tone={data.ready ? "ok" : "warn"} />
        </div>
        <div className="rows">
          {data.checks.map((check) => (
            <div className="row" key={check.id} style={{ alignItems: "flex-start" }}>
              <span
                className={`mk-sm ${check.done ? "ok" : check.required ? "fail" : "info"}`}
                aria-hidden="true"
              >
                {check.done ? "✓" : check.required ? "!" : "·"}
              </span>
              <div className="grow">
                <div className="hstack-w">
                  <span className="row-title">{check.title}</span>
                  {check.required && !check.done ? <Pill tone="danger">needed</Pill> : null}
                </div>
                <div className="t-xs dimmer" style={{ marginTop: 2 }}>
                  {check.detail}
                </div>
                {!check.done ? (
                  <div className="t-xs faint" style={{ marginTop: 3 }}>
                    Unlocks: {check.unlocks}
                  </div>
                ) : null}
              </div>
              {check.done ? (
                <Pill tone="ok">
                  <Check className="ico" style={{ width: 11, height: 11 }} aria-hidden="true" />
                  done
                </Pill>
              ) : (
                <Link href={check.href} className="btn btn-sm">
                  {check.action}
                  <ChevronRight className="ico" aria-hidden="true" />
                </Link>
              )}
            </div>
          ))}
        </div>
      </Card>

      {outstanding.length === 0 ? (
        <p className="t-sm faint" style={{ margin: 0 }}>
          Everything is configured. This page stays as the map of what is switched on.
        </p>
      ) : null}
    </div>
  );
}

/** Compact nudge for the Inbox, shown until the blocking checks pass. */
export function SetupBanner() {
  const setup = useSetup();
  const data = setup.data;
  if (!data || (data.ready && !data.fresh)) return null;

  const next = data.checks.find((c) => !c.done);
  if (!next) return null;

  return (
    <div className="banner warn" style={{ marginBottom: 18 }}>
      <div className="b-ico">{data.done}</div>
      <div className="grow">
        <h3>
          {data.fresh ? "Finish setting up archfleet" : "Some setup is still outstanding"}
        </h3>
        <p>
          {data.done} of {data.total} done. Next: {next.title.toLowerCase()} — {next.unlocks}
        </p>
      </div>
      <div className="hstack">
        <Link href={next.href} className="btn btn-sm">
          {next.action}
        </Link>
        <Link href="/settings?tab=setup" className="btn btn-primary btn-sm">
          Open setup
        </Link>
      </div>
    </div>
  );
}
