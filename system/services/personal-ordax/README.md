# Personal OrdaX service

This service owns the orchestration lifecycle for `ordax.personal-work-item/1`. It does not own
identity, Memory, Spaces, Projects, inference, grants or platform adapters.

The current source runtime is deliberately foreground-only:

- work is created against the exact current device/account owner;
- Space and project scopes are opt-in and explicit, never inferred from "whatever is selected";
- identity change, Space switch or project disappearance pauses affected active work;
- an inference response that returns after its owner/context changed is discarded instead of being
  committed to the wrong work item;
- Intelligence remains consultative and no action/tool execution is enabled;
- lifecycle events are ordered and user-visible through `ordax.personal-activity/1`;
- durable persistence is injected through `ordax.personal-work-store/1`; no second Memory or sync
  subsystem exists here;
- terminal work can be removed together with its activity history so bounded storage cannot become
  permanently exhausted.

The runtime is not yet mounted in Web/Native composition and therefore does not claim a public
Activity UI or autonomous/background execution.
