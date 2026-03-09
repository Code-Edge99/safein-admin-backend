import { BehaviorConditionResponseDto } from './dto';

export function toBehaviorConditionResponseDto(condition: any): BehaviorConditionResponseDto {
  return {
    id: condition.id,
    name: condition.name,
    enableDistanceCondition: condition.distanceThreshold !== null,
    enableStepsCondition: condition.stepsThreshold !== null,
    enableSpeedCondition: condition.speedThreshold !== null,
    distanceThreshold: condition.distanceThreshold,
    stepsThreshold: condition.stepsThreshold,
    speedThreshold: condition.speedThreshold,
    description: condition.description,
    isActive: condition.isActive,
    organization: condition.organization,
    workType: condition.workType,
    policyCount: condition._count?.policyBehaviors ?? 0,
    createdAt: condition.createdAt,
    updatedAt: condition.updatedAt,
  };
}
