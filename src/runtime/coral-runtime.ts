export interface CoralRuntimeOptions {
  agentName: string;
  profileName: string;
  maxIterations: number;
}

export interface CoralTaskContext {
  threadId?: string;
  requester?: string;
  payload: unknown;
}

export interface CoralRuntime {
  run(options: CoralRuntimeOptions): Promise<never>;
}

export async function runCoralTaskLoop(
  _options: CoralRuntimeOptions
): Promise<never> {
  throw new Error(
    "Coral runtime scaffold only: implement the bounded multi-step task loop next."
  );
}
