import { BehaviorConditionResponseDto } from './dto';

function mapPolicyNames(relations: any[] | undefined): string[] {
  if (!Array.isArray(relations)) {
    return [];
  }

  return relations
    .map((relation) => relation?.policy?.name)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
}

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
    organization: condition.organization,
    policyCount: condition._count?.policyBehaviors ?? 0,
    policyNames: mapPolicyNames(condition.policyBehaviors),
    createdAt: condition.createdAt,
    updatedAt: condition.updatedAt,
  };
}
