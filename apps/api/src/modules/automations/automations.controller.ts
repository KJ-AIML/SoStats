import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { AutomationsService } from './automations.service.js';
import { CreateAutomationDto } from './automations.dto.js';

@Controller('v1/automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Get()
  async findAll() {
    return this.automationsService.findAll();
  }

  @Post()
  async create(@Body() body: CreateAutomationDto) {
    return this.automationsService.create(body);
  }

  @Post(':id/run')
  async run(@Param('id', ParseIntPipe) id: number) {
    return this.automationsService.run(id);
  }
}
