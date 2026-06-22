import { IsBoolean } from 'class-validator';

/** Body for the `PATCH :id/lock` endpoints across cpanel masters. */
export class LockDto {
  @IsBoolean()
  locked: boolean;
}
