import { BaseAgent, SequentialAgent, InMemoryRunner, createEvent } from "@google/adk";
import crypto from "node:crypto";
import { ingestAgent } from "./ingestAgent.js";
import { conceptAgent } from "./conceptAgent.js";
import { socraticAgent } from "./socraticAgent.js";
import { examinerAgent } from "./examinerAgent.js";
import { stressTestAgent } from "./stressTestAgent.js";

const APP_NAME = "samajh_adk_pipeline";

class IngestAdkAgent extends BaseAgent {
  async *runAsyncImpl(ctx) {
    const stages = ctx.session.state.activeStages || [];
    if (!stages.includes("ingest")) return;

    const result = await ingestAgent(ctx.session.state.ingestInput || {});
    yield createEvent({
      invocationId: ctx.invocationId,
      author: this.name,
      actions: {
        stateDelta: {
          raw_text: result.raw_text,
        },
      },
    });
  }
  async *runLiveImpl() {}
}

class ConceptAdkAgent extends BaseAgent {
  async *runAsyncImpl(ctx) {
    const stages = ctx.session.state.activeStages || [];
    if (!stages.includes("concept")) return;

    const result = await conceptAgent({
      raw_text: ctx.session.state.raw_text,
      moduleId: ctx.session.state.nismModule || "series-viii",
    });
    yield createEvent({
      invocationId: ctx.invocationId,
      author: this.name,
      actions: {
        stateDelta: {
          concept: result.concept,
          analogy: result.analogy,
          concept_grounding: result.grounding,
        },
      },
    });
  }
  async *runLiveImpl() {}
}

class SocraticAdkAgent extends BaseAgent {
  async *runAsyncImpl(ctx) {
    const stages = ctx.session.state.activeStages || [];
    if (!stages.includes("socratic")) return;

    const result = await socraticAgent({
      concept: ctx.session.state.concept,
      turns: ctx.session.state.turns || [],
      language: ctx.session.state.language || "en-IN",
      moduleId: ctx.session.state.nismModule || "series-viii",
    });
    yield createEvent({
      invocationId: ctx.invocationId,
      author: this.name,
      actions: {
        stateDelta: {
          socratic_reply: result.reply,
          socratic_done: result.done,
        },
      },
    });
  }
  async *runLiveImpl() {}
}

class ExaminerAdkAgent extends BaseAgent {
  async *runAsyncImpl(ctx) {
    const stages = ctx.session.state.activeStages || [];
    if (!stages.includes("examiner")) return;

    const result = await examinerAgent({
      concept: ctx.session.state.concept,
      turns: ctx.session.state.turns || [],
      language: ctx.session.state.language || "en-IN",
      moduleId: ctx.session.state.nismModule || "series-viii",
    });
    yield createEvent({
      invocationId: ctx.invocationId,
      author: this.name,
      actions: {
        stateDelta: {
          examiner_result: result,
        },
      },
    });
  }
  async *runLiveImpl() {}
}

class StressTestAdkAgent extends BaseAgent {
  async *runAsyncImpl(ctx) {
    const stages = ctx.session.state.activeStages || [];
    if (!stages.includes("stresstest")) return;

    const result = await stressTestAgent({
      weak_subtopic: ctx.session.state.weak_subtopic,
      concept: ctx.session.state.concept,
      user_reasoning: ctx.session.state.user_reasoning,
      scenario: ctx.session.state.scenario,
      scenarios: ctx.session.state.scenarios,
    });
    yield createEvent({
      invocationId: ctx.invocationId,
      author: this.name,
      actions: {
        stateDelta: {
          stresstest_result: result,
        },
      },
    });
  }
  async *runLiveImpl() {}
}

/**
 * Canonical 5-agent ADK SequentialAgent pipeline for Samajh.
 * Sub-agents run in strict linear order with shared ADK session state propagation.
 */
export const samajhSequentialPipeline = new SequentialAgent({
  name: "SamajhVerificationPipeline",
  description:
    "5-agent SequentialAgent pipeline for NISM understanding verification: " +
    "Ingest -> Concept (RAG-grounded) -> Socratic Teach-Back -> Examiner (ADK CodeExec + RAG) -> Stress-Test (ADK CodeExec + Ground-Truth Bank).",
  subAgents: [
    new IngestAdkAgent({
      name: "IngestAgent",
      description: "Extracts study text directly from page photos via Gemini multimodal or pasted text.",
    }),
    new ConceptAdkAgent({
      name: "ConceptAgent",
      description: "Distills one NISM concept and trading analogy grounded in NISM workbook references.",
    }),
    new SocraticAdkAgent({
      name: "SocraticAgent",
      description: "Plays a confused novice over 3 turns to probe reasoning gaps.",
    }),
    new ExaminerAdkAgent({
      name: "ExaminerAgent",
      description: "Grades learner turns with NISM RAG grounding and ADK Python Code Execution.",
    }),
    new StressTestAdkAgent({
      name: "StressTestAgent",
      description: "Grades reasoning on real dated Indian market shocks with ADK Python Code Execution.",
    }),
  ],
});

/**
 * Execute one or more ordered stages through the literal ADK SequentialAgent + InMemoryRunner.
 */
export async function runSamajhPipeline(initialState) {
  const runner = new InMemoryRunner({
    agent: samajhSequentialPipeline,
    appName: APP_NAME,
  });

  const userId = "samajh-learner";
  const adkSessionId = `adk_${crypto.randomUUID()}`;

  await runner.sessionService.createSession({
    appName: APP_NAME,
    userId,
    sessionId: adkSessionId,
    state: initialState,
  });

  const executedAgents = [];
  for await (const event of runner.runAsync({
    userId,
    sessionId: adkSessionId,
    newMessage: {
      role: "user",
      parts: [{ text: `Execute Samajh stages: ${(initialState.activeStages || []).join(" -> ")}` }],
    },
  })) {
    if (event?.author && !executedAgents.includes(event.author)) {
      executedAgents.push(event.author);
    }
  }

  const finalSession = await runner.sessionService.getSession({
    appName: APP_NAME,
    userId,
    sessionId: adkSessionId,
  });

  return {
    state: finalSession?.state || {},
    adk_trace: {
      pipeline: samajhSequentialPipeline.name,
      sdk: "@google/adk",
      executed_agents: executedAgents,
    },
  };
}
