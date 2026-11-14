import { useEffect, useRef } from "react";
import { t } from "../locale";

const steps = [
  [
    "A request arrives",
    "The generator sends requests to the entry group. Routing chooses which instance receives each call.",
  ],
  [
    "It waits for a free worker",
    "Each box has a limited number of workers (processing slots). When all are busy, requests wait in arrival order. A full queue rejects new arrivals.",
  ],
  [
    "It does work and makes calls",
    "The box performs its local work, then calls other boxes if its program says to. Its worker stays occupied while it waits for their results.",
  ],
  [
    "It returns a result",
    "When the operation ends, its worker is free for the next request. The caller receives a response or an error; it can also stop waiting when its timeout expires.",
  ],
];

const topics = [
  {
    title: "Traffic and scaling",
    paragraphs: [
      "RPS means requests per second. The generator sets the total for the entry group: 200 RPS across four instances is still 200 RPS, not 800. Downstream traffic depends on the calls each request makes.",
      "Adding instances adds capacity. Removing an instance stops new assignments, but lets accepted work finish there; its queue does not move. Autoscaling adjusts the instance count using queue length or utilization.",
      "Changing numeric settings or instance counts preserves time, queues and history. New settings do not recalculate work already scheduled. Changing the structure can require a restart, which the editor indicates.",
    ],
  },
  {
    title: "Boxes, resources and request paths",
    paragraphs: [
      "A backend, database, CPU or disk uses the same building block: a queue, workers and a program. A group contains instances with common settings; an individual instance can override them.",
      "A box can contain other boxes, each with its own queue and workers. They do work only when explicitly called. Private resources are copied with each instance; shared resources keep one common pool as the group grows.",
      "Programs run stages in order. Calls within one stage run in parallel and wait for all successes, the first success, or a chosen number of successes (quorum). Request labels can select which calls run.",
      "Processing time is multiplied by request weight. Network links add connection setup and travel time; ideal links add neither, but requests still queue and use workers.",
    ],
  },
  {
    title: "Timeouts and cancellation",
    paragraphs: [
      "The user deadline limits the wait for the whole request. A call timeout limits one outgoing call, including connection setup, travel, queueing, processing and the reply. These settings belong to the caller; the generator has separate connection settings.",
      "Connect timeout limits opening a connection. Keep-alive reuses open connections. Idle timeout closes an unused connection after a period of inactivity; it never interrupts an active call.",
      "A timeout means the caller stops waiting. With cancellation enabled, unfinished downstream work is canceled too. With cancellation disabled, that work can keep workers busy even after the user has received an error.",
      "By default, connection-establishment failures can try another instance within the same call budget. Failures after the connection is established are not retried.",
    ],
  },
  {
    title: "Reading charts and traces",
    paragraphs: [
      "Utilization is the share of worker capacity occupied over time, including workers waiting for child calls. A busy service does not necessarily mean a busy CPU: internal resources have separate utilization. Queued requests are counted separately.",
      "End-to-end latency is the time from sending a request to receiving its result. The p95 chart covers successful requests: 95% of them finish within that time. Check errors alongside it, because timeouts are not included in successful latency.",
      "Select a request to see where it spent time. Parent spans already include waiting for children, so adding parent and child durations would count the same time twice.",
      "Little’s law relates average requests inside a box (L), completed visits per second (λ) and their average time inside (W). Over a finite experiment, L = λ × W plus the accumulated ages of unfinished visits divided by elapsed time. That unfinished part matters when queues grow or work hangs.",
    ],
  },
  {
    title: "Virtual time and model limits",
    paragraphs: [
      "The clock shows simulated time. Playback speed changes how fast you watch, not how the model behaves. The same seed, settings and changes at the same simulated times reproduce the same experiment.",
      "This is a model of capacity, waiting and dependencies. Names such as database, CPU or NUMA do not add real database protocols or hardware behavior. Locality labels can influence routing and costs; their timings are illustrative.",
    ],
  },
];

export function ModelHelp({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    title.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      id="model-help"
      ref={dialog}
      aria-labelledby="model-help-title"
      aria-describedby="model-help-intro"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          close();
      }}
    >
      <div className="modal-head">
        <h2 id="model-help-title" ref={title} tabIndex={-1}>
          {t("How the model works")}
        </h2>
        <button aria-label={t("Close")} onClick={close}>
          ×
        </button>
      </div>
      <div className="model-help-body">
        <p id="model-help-intro" className="model-help-intro">
          {t(
            "Follow a request through a system with limited capacity. See how slow work creates queues, how waiting spreads to other services, and when users hit timeouts.",
          )}
        </p>
        <section aria-labelledby="model-help-path">
          <h3 id="model-help-path">{t("The journey of one request")}</h3>
          <ol className="model-help-steps">
            {steps.map(([heading, description], index) => (
              <li key={heading}>
                <span className="model-help-number" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h4>{t(heading)}</h4>
                  <p>{t(description)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="model-help-example">
          <h3>{t("Why one slow box can hold up the system")}</h3>
          <p>
            {t(
              "Imagine a backend waiting for a slow database. Its worker is still occupied, even though it is not doing local work. Once all backend workers are waiting, new requests queue there too. Adding backends may only send more work to the same overloaded database.",
            )}
          </p>
        </section>
        <section className="model-help-try">
          <h3>{t("Try it in the lab")}</h3>
          <p>
            {t(
              "Start with Normal operation. Select the database and increase Processing, ms. Watch its queue, backend workers and user errors. Then use Single request mode and select the request to follow its path step by step.",
            )}
          </p>
        </section>
        <section
          className="model-help-topics"
          aria-labelledby="model-help-more"
        >
          <h3 id="model-help-more">{t("More about the rules")}</h3>
          {topics.map(({ title, paragraphs }) => (
            <details key={title}>
              <summary>{t(title)}</summary>
              {paragraphs.map((paragraph) => (
                <p key={paragraph}>{t(paragraph)}</p>
              ))}
            </details>
          ))}
        </section>
      </div>
      <div className="model-help-footer">
        <button className="primary-button" onClick={close}>
          {t("Back to the experiment")}
        </button>
      </div>
    </dialog>
  );
}
