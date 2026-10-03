# Proactive Research

This foundation is the first deliberately low-authority background-style workload for OrdaX.

It is **local and read-only**. A research source must declare `network: false` and `mutation: false`, and every read must pass an explicit authorization port bound to owner, Space, Project, subject and source before the source is touched.

Supported source classes are intentionally narrow:

- Memory;
- Work;
- Project;
- file metadata;
- system status.

Arbitrary files, browser content, email, cloud connectors and the public web are not enabled by this foundation.

## Authority

Research request, source reads, analyzer input and final result all remain `authority: none`. A result is evidence-backed advice only. It cannot create a grant, change a Work, write Memory, publish, send, modify files, control the device or bypass Action Policy / Action Review / Action Gateway.

The analyzer is also required to declare `network: false` and `mutation: false`. This allows a future local Intelligence adapter without granting it network or mutation through the research path.

## Privacy and sensitivity

Evidence remains bounded and carries a provenance reference plus sensitivity. `restricted` evidence is filtered by the runtime unless the exact request explicitly asks for it and the authorization port allows that read. Consumers must not treat `includeRestricted=true` as authorization by itself.

## Composition status

This is source foundation only. It is not yet wired to Scheduler, Background Runtime, Activity or the Personal OrdaX Work lifecycle, and it does not enable background execution in the public product.
