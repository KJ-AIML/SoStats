export class CreateScheduleDto {
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
  startDate?: string;
  endDate?: string;
}
