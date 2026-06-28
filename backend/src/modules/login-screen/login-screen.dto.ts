import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Font / size / colour / style for one piece of text. */
export class TextStyleDto {
  @IsOptional() @IsString() fontFamily?: string;
  @IsOptional() @IsInt() @Min(8) @Max(96) fontSize?: number;
  @IsOptional() @IsString() color?: string; // hex
  @IsOptional() @IsBoolean() bold?: boolean;
  @IsOptional() @IsBoolean() italic?: boolean;
  @IsOptional() @IsString() @IsIn(['left', 'center', 'right']) align?: string;
}

/** A call-to-action button on the branding panel (Layout 2). */
export class CtaButtonDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() url?: string;
}

/** A generic show/label/url link (forgot password, "Know more", social button). */
export class LinkDto {
  @IsOptional() @IsBoolean() show?: boolean;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() url?: string;
}

/** "Don't have an account? Sign up" line. */
export class SignUpDto {
  @IsOptional() @IsBoolean() show?: boolean;
  @IsOptional() @IsString() prompt?: string;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() url?: string;
}

/**
 * The whole login-screen appearance. Stored as a JSON blob on the singleton
 * LoginScreenConfig row. All fields optional; the frontend fills gaps with
 * DEFAULT_LOGIN_CONFIG. `@IsOptional()` also permits explicit null (used to
 * clear the logo or the background selection).
 */
export class LoginScreenConfigDto {
  @IsOptional() @IsString() logoUrl?: string | null;
  @IsOptional() @IsInt() @Min(16) @Max(400) logoSize?: number;

  @IsOptional() @IsString() heading?: string;
  @IsOptional() @ValidateNested() @Type(() => TextStyleDto) headingStyle?: TextStyleDto;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @ValidateNested() @Type(() => TextStyleDto) descriptionStyle?: TextStyleDto;

  // Rich-text (WYSIWYG) HTML; sanitized on the frontend before rendering.
  @IsOptional() @IsString() headingHtml?: string;
  @IsOptional() @IsString() descriptionHtml?: string;
  @IsOptional() @IsString() overlayHeadingHtml?: string;
  @IsOptional() @IsString() overlayTextHtml?: string;

  @IsOptional() @IsString() cardColor?: string; // hex, login card background
  @IsOptional() @IsInt() @Min(0) @Max(100) cardOpacity?: number; // card fill opacity %
  @IsOptional() @IsString() pageColor?: string; // hex, page background when no media

  @IsOptional() @IsInt() backgroundMediaId?: number | null; // LoginMedia.id or null

  @IsOptional() @IsString() copyright?: string;
  @IsOptional() @ValidateNested() @Type(() => TextStyleDto) copyrightStyle?: TextStyleDto;

  // --- layout & form ---
  @IsOptional() @IsString() @IsIn(['centered', 'split']) layout?: string;

  @IsOptional() @IsString() formTitle?: string;
  @IsOptional() @ValidateNested() @Type(() => TextStyleDto) formTitleStyle?: TextStyleDto;

  @IsOptional() @IsString() usernameLabel?: string;
  @IsOptional() @IsString() passwordLabel?: string;
  @IsOptional() @IsString() submitLabel?: string;
  @IsOptional() @IsString() buttonColor?: string; // hex; submit button (defaults to brand)

  // CTA buttons shown on the Layout 1 centered branding.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => CtaButtonDto)
  buttons?: CtaButtonDto[];

  @IsOptional() @IsBoolean() showRememberMe?: boolean;
  @IsOptional() @IsString() rememberMeLabel?: string;

  @IsOptional() @ValidateNested() @Type(() => LinkDto) forgotPassword?: LinkDto;

  // Secondary / social sign-in button (e.g. "Sign in with Google"). Display-only.
  @IsOptional() @ValidateNested() @Type(() => LinkDto) secondaryButton?: LinkDto;

  // "Don't have an account? Sign up" line.
  @IsOptional() @ValidateNested() @Type(() => SignUpDto) signUp?: SignUpDto;

  // --- Layout 2 image panel overlay ---
  @IsOptional() @IsString() overlayHeading?: string;
  @IsOptional() @ValidateNested() @Type(() => TextStyleDto) overlayHeadingStyle?: TextStyleDto;

  @IsOptional() @IsString() overlayText?: string;
  @IsOptional() @ValidateNested() @Type(() => TextStyleDto) overlayTextStyle?: TextStyleDto;

  @IsOptional() @ValidateNested() @Type(() => LinkDto) knowMore?: LinkDto;
}

export class SaveLoginScreenDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LoginScreenConfigDto)
  config?: LoginScreenConfigDto | null;
}
