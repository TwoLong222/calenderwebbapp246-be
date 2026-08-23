import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const NOTE_COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export class CreateNoteDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) content?: string;
  @IsOptional() @IsString() @IsIn(NOTE_COLORS) color?: NoteColor;
  @IsOptional() @IsBoolean() pinned?: boolean;
}
