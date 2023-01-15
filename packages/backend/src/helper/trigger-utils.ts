import { pieces, Trigger, TriggerStrategy } from "pieces";
import {
  CollectionId,
  CollectionVersion,
  CollectionVersionId,
  FlowId,
  FlowVersion,
  PieceTrigger,
  ProjectId,
  RunEnvironment,
  TriggerHookType,
  TriggerType,
} from "shared";
import { ActivepiecesError, ErrorCode } from "shared";
import { flowQueue } from "../workers/flow-worker/flow-queue";
import { createContextStore } from "../store-entry/store-entry.service";
import { getBackendUrl } from "./public-ip-utils";
import { engineHelper } from "./engine-helper";

const EVERY_FIFTEEN_MINUTES = "* 15 * * * *";

export const triggerUtils = {
  async executeTrigger({ collectionId, payload, flowVersion }: ExecuteTrigger): Promise<any[]> {
    const flowTrigger = flowVersion.trigger;
    let payloads = [];
    switch (flowTrigger.type) {
      case TriggerType.PIECE:
        const pieceTrigger = getPieceTrigger(flowTrigger);
        payloads = await pieceTrigger.run({
          store: createContextStore(collectionId),
          webhookUrl: await getWebhookUrl(flowVersion.flowId),
          propsValue: flowTrigger.settings.input,
          payload: payload,
        });
        break;
      default:
        payloads = [payload];
        break;
    }
    return payloads;
  },

  async enable({ collectionId, collectionVersion, flowVersion, projectId }: EnableOrDisableParams): Promise<void> {
    switch (flowVersion.trigger.type) {
      case TriggerType.PIECE:
        await enablePieceTrigger({ collectionId, collectionVersion, projectId, flowVersion });
        break;

      case TriggerType.SCHEDULE:
        console.log("Created Schedule for flow version Id " + flowVersion.id);

        await flowQueue.add({
          id: flowVersion.id,
          data: {
            environment: RunEnvironment.PRODUCTION,
            collectionId,
            collectionVersionId: collectionVersion.id,
            flowVersion,
            triggerType: TriggerType.SCHEDULE,
          },
          cronExpression: flowVersion.trigger.settings.cronExpression,
        });

        break;
      default:
        break;
    }
  },

  async disable({ collectionId, collectionVersion, flowVersion, projectId }: EnableOrDisableParams): Promise<void> {
    switch (flowVersion.trigger.type) {
      case TriggerType.PIECE:
        await disablePieceTrigger({ collectionId, collectionVersion, projectId, flowVersion });
        break;

      case TriggerType.SCHEDULE:
        console.log("Deleted Schedule for flow version Id " + flowVersion.id);
        await flowQueue.remove({
          id: flowVersion.id,
          repeatable: true,
        });
        break;

      default:
        break;
    }
  },
};

const disablePieceTrigger = async ({ flowVersion, projectId, collectionId, collectionVersion }: EnableOrDisableParams): Promise<void> => {
  const flowTrigger = flowVersion.trigger as PieceTrigger;
  const pieceTrigger = getPieceTrigger(flowTrigger);

  switch (pieceTrigger.type) {
    case TriggerStrategy.WEBHOOK:
      await engineHelper.executeTrigger({
        hookType: TriggerHookType.ON_DISABLE,
        flowVersion: flowVersion,
        webhookUrl: await getWebhookUrl(flowVersion.flowId),
        collectionVersion: collectionVersion,
        projectId: projectId
      });
      await pieceTrigger.onDisable({
        store: createContextStore(collectionId),
        webhookUrl: await getWebhookUrl(flowVersion.flowId),
        propsValue: flowTrigger.settings.input,
      });
      break;

    case TriggerStrategy.POLLING:
      await flowQueue.remove({
        id: flowVersion.id,
        repeatable: true,
      });
      break;
  }
};

const enablePieceTrigger = async ({ flowVersion, projectId, collectionId, collectionVersion }: EnableOrDisableParams): Promise<void> => {
  const flowTrigger = flowVersion.trigger as PieceTrigger;
  const pieceTrigger = getPieceTrigger(flowTrigger);

  switch (pieceTrigger.type) {
    case TriggerStrategy.WEBHOOK:
      await engineHelper.executeTrigger({
        hookType: TriggerHookType.ON_ENABLE,
        flowVersion: flowVersion,
        webhookUrl: await getWebhookUrl(flowVersion.flowId),
        collectionVersion: collectionVersion,
        projectId: projectId
      });
      break;
    case TriggerStrategy.POLLING:
      await flowQueue.add({
        id: flowVersion.id,
        data: {
          environment: RunEnvironment.PRODUCTION,
          collectionId,
          collectionVersionId: collectionVersion.id,
          flowVersion,
          triggerType: TriggerType.PIECE,
        },
        cronExpression: EVERY_FIFTEEN_MINUTES,
      });

      break;
  }
};

const getPieceTrigger = (trigger: PieceTrigger): Trigger => {
  const piece = pieces.find((p) => p.name === trigger.settings.pieceName);

  if (piece == null) {
    throw new ActivepiecesError({
      code: ErrorCode.PIECE_NOT_FOUND,
      params: {
        pieceName: trigger.settings.pieceName,
      },
    });
  }
  const pieceTrigger = piece.getTrigger(trigger.settings.triggerName);
  if (pieceTrigger == null) {
    throw new ActivepiecesError({
      code: ErrorCode.PIECE_TRIGGER_NOT_FOUND,
      params: {
        pieceName: trigger.settings.pieceName,
        triggerName: trigger.settings.triggerName,
      },
    });
  }

  return pieceTrigger;
};

const getWebhookUrl = async (flowId: FlowId): Promise<string> => {
  const webhookPath = `v1/webhooks?flowId=${flowId}`;
  let serverUrl = await getBackendUrl();
  return `${serverUrl}/${webhookPath}`;
};

interface EnableOrDisableParams {
  collectionId: CollectionId;
  collectionVersion: CollectionVersion;
  flowVersion: FlowVersion;
  projectId: ProjectId;
}

interface ExecuteTrigger {
  payload: any;
  collectionId: CollectionId;
  flowVersion: FlowVersion;
}
