import { HttpException, HttpStatus } from '@nestjs/common';

export class LandlordNotFoundException extends HttpException {
  constructor(landlordId: string) {
    super(`Landlord not found: ${landlordId}`, HttpStatus.NOT_FOUND);
  }
}

export class TaxRecordNotFoundException extends HttpException {
  constructor(landlordId: string, year: number) {
    super(
      `Tax record not found for landlord ${landlordId} in year ${year}`,
      HttpStatus.NOT_FOUND,
    );
  }
}

export class CalculationFailedException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

export class EmailSendException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

export class PropertyAccessDeniedException extends HttpException {
  constructor() {
    super('You do not have access to this property', HttpStatus.FORBIDDEN);
  }
}

export class TaxAccessDeniedException extends HttpException {
  constructor() {
    super('You do not have access to this tax record', HttpStatus.FORBIDDEN);
  }
}
