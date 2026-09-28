export class CreateScheduleDto {
  workspaceId!: number;
  contentItemId!: number;
  variantId?: number;
  socialAccountId!: number;
  scheduledAt!: string;
}

export class UpdateScheduleDto {
  scheduledAt?: string;
  status?: string;
}

export class GetCalendarDto {
  workspaceId!: number;
  startDate?: string;
  endDate?: string;
}
