import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/auth.types.js';
import { WorkspacesService } from './workspaces.service.js';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  create(@Body('name') name: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.create(name, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.findAllForUser(user.id);
  }

  @Get(':id/settings')
  settings(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.settings(id, user.id);
  }

  @Put(':id/settings')
  updateSettings(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { name?: string; timezone?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.updateSettings(id, user.id, body);
  }

  @Put(':id/members/:memberId/role')
  updateMemberRole(
    @Param('id', ParseIntPipe) id: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body('role') role: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.updateMemberRole(
      id,
      user.id,
      memberId,
      role,
    );
  }

  @Delete(':id/members/:memberId')
  removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.removeMember(id, user.id, memberId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.findOneForUser(id, user.id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body('name') name: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.update(id, user.id, name);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.remove(id, user.id);
  }
}
