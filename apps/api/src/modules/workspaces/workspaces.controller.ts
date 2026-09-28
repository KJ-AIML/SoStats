import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  Headers,
} from '@nestjs/common';
import { WorkspacesService } from './workspaces.service.js';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  // Dummy extract user ID from headers for now
  private getUserId(headers: Record<string, string | undefined>): number {
    return headers['x-user-id']
      ? parseInt(headers['x-user-id'] as string, 10)
      : 1;
  }

  @Post()
  create(
    @Body('name') name: string,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const userId = this.getUserId(headers);
    return this.workspacesService.create(name, userId);
  }

  @Get()
  findAll(@Headers() headers: Record<string, string | undefined>) {
    const userId = this.getUserId(headers);
    return this.workspacesService.findAllForUser(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workspacesService.findOne(+id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body('name') name: string) {
    return this.workspacesService.update(+id, name);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workspacesService.remove(+id);
  }
}
