"use client";

// What you can add to a graph: the built-in steps, the rules, and every node
// type anyone has defined. Custom types sit in the same list as the built-ins —
// that is the point of them.

import { useState } from "react";
import { Blocks, Search } from "lucide-react";
import { Modal } from "@/components/ui/Overlay";
import { Chip, Empty } from "@/components/ui/primitives";
import type { CustomNodeType } from "@/lib/fleet/node-types";
import type { NodeKind } from "@/lib/fleet/types";

export type PaletteChoice =
  | { kind: Exclude<NodeKind, "custom">; name: string }
  | { kind: "custom"; name: string; customTypeId: string };

type Entry = {
  kind: NodeKind;
  name: string;
  group: "Does something" | "Decides something" | "Your node types";
  blurb: string;
  customTypeId?: string;
};

const BUILT_IN: Entry[] = [
  {
    kind: "computer_use_task",
    name: "Desktop step",
    group: "Does something",
    blurb: "Drive the desktop in plain language — the agent looks at the screen.",
  },
  {
    kind: "browser_task",
    name: "Browser step",
    group: "Does something",
    blurb: "A deterministic list of browser actions. No model, so it is cheap and repeatable.",
  },
  {
    kind: "api_call",
    name: "API call",
    group: "Does something",
    blurb: "Call an HTTP endpoint. The response is available to later steps.",
  },
  {
    kind: "shell_task",
    name: "Shell command",
    group: "Does something",
    blurb: "Run a command on the controller and keep its output.",
  },
  {
    kind: "cli_agent_task",
    name: "CLI agent",
    group: "Does something",
    blurb: "Hand a task to Claude Code or Codex on the controller.",
  },
  {
    kind: "otp_email",
    name: "Read a code from email",
    group: "Does something",
    blurb: "Pull a verification code out of a mailbox into a param.",
  },
  {
    kind: "human_takeover",
    name: "Ask a human",
    group: "Decides something",
    blurb: "Stop and ask for a value, a choice or an approval. The answer comes back into the run.",
  },
  {
    kind: "condition",
    name: "If",
    group: "Decides something",
    blurb: "Continue one way or the other based on a rule.",
  },
  {
    kind: "switch",
    name: "Switch",
    group: "Decides something",
    blurb: "Several labelled branches — the first matching rule wins.",
  },
  {
    kind: "wait",
    name: "Wait",
    group: "Decides something",
    blurb: "Pause for a while, or keep polling something until it is ready.",
  },
  {
    kind: "set_params",
    name: "Set values",
    group: "Decides something",
    blurb: "Compute values from earlier steps for later ones to use.",
  },
  {
    kind: "retry_wait",
    name: "Retry the last step",
    group: "Decides something",
    blurb: "Re-run the previous task a few times before giving up.",
  },
];

export function NodePalette({
  open,
  onClose,
  onPick,
  nodeTypes,
  onManageTypes,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (choice: PaletteChoice) => void;
  nodeTypes: CustomNodeType[];
  onManageTypes?: () => void;
}) {
  const [query, setQuery] = useState("");

  const entries: Entry[] = [
    ...BUILT_IN,
    ...nodeTypes.map((t) => ({
      kind: "custom" as const,
      name: t.name,
      group: "Your node types" as const,
      blurb: t.description || `Runs as ${t.base}.`,
      customTypeId: t.id,
    })),
  ];

  const visible = entries.filter(
    (e) =>
      !query.trim() ||
      `${e.name} ${e.blurb}`.toLowerCase().includes(query.toLowerCase()),
  );
  const groups: Entry["group"][] = ["Does something", "Decides something", "Your node types"];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a step"
      subtitle="Built-ins, rules, and anything your team has defined."
      headRight={
        onManageTypes ? (
          <button type="button" className="btn btn-sm" onClick={onManageTypes}>
            <Blocks className="ico" aria-hidden="true" />
            Node types
          </button>
        ) : undefined
      }
    >
      <div className="stack">
        <div className="searchbtn" style={{ minWidth: 0 }}>
          <Search className="ico" aria-hidden="true" />
          <input
            className="grow"
            aria-label="Search steps"
            placeholder="Search steps…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            style={{ background: "none", border: "none", outline: "none", color: "var(--text)" }}
          />
        </div>

        {visible.length === 0 ? <Empty>Nothing matches “{query}”.</Empty> : null}

        {groups.map((group) => {
          const inGroup = visible.filter((e) => e.group === group);
          if (inGroup.length === 0) return null;
          return (
            <section key={group} className="stack-s">
              <span className="t-label">{group}</span>
              <div className="itemlist">
                {inGroup.map((entry) => (
                  <button
                    key={`${entry.kind}-${entry.customTypeId ?? entry.name}`}
                    type="button"
                    className="item"
                    style={{ alignItems: "flex-start" }}
                    onClick={() => {
                      onPick(
                        entry.kind === "custom"
                          ? { kind: "custom", name: entry.name, customTypeId: entry.customTypeId! }
                          : ({ kind: entry.kind, name: entry.name } as PaletteChoice),
                      );
                      onClose();
                    }}
                  >
                    <div className="grow">
                      <div className="hstack" style={{ gap: 7 }}>
                        <span className="strong t-sm">{entry.name}</span>
                        {entry.kind === "custom" ? <Chip>yours</Chip> : null}
                      </div>
                      <div className="t-xs faint" style={{ marginTop: 2 }}>
                        {entry.blurb}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          );
        })}

        {nodeTypes.length === 0 ? (
          <p className="t-xs faint" style={{ margin: 0 }}>
            No node types of your own yet — build one under Settings › Node types and it shows up here.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
