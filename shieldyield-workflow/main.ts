import { CronCapability, handler, Runner, type Runtime } from "@chainlink/cre-sdk";

type Addresses = {
  mockUSDC: string;
  faucet: string;
  riskRegistry: string;
  shieldVault: string;
  shieldBridge: string;
  aaveAdapter: string;
  compoundAdapter: string;
  morphoAdapter: string;
  yieldMaxAdapter: string;
}

type EvmConfig = {
  chainName: string;
  addresses: Addresses[];
}

type Config = {
  evms: EvmConfig[];
};

const onCronTrigger = (runtime: Runtime<Config>): string => {
  runtime.log("Hello world! Workflow triggered.");
  return "Hello world!";
};

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();

  return [
    handler(
      cron.trigger(
        {}
      ),
      onCronTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
