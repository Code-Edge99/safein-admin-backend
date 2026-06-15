import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  RequestBoardResponseDto,
  RequestBoardUpdateDto,
} from "./dto/request-board.dto";
import { RequestBoardService } from "./request-board.service";

@ApiTags("공용 요청사항 보드")
@Controller("dev/request-board")
export class RequestBoardController {
  constructor(private readonly requestBoardService: RequestBoardService) {}

  @Get(":boardId")
  @ApiParam({
    name: "boardId",
    description: "요청사항 보드 ID",
    example: "main-request-board",
  })
  @ApiOperation({ summary: "공용 요청사항 보드 조회" })
  @ApiResponse({ status: 200, type: RequestBoardResponseDto })
  findCurrent(
    @Param("boardId") boardId: string,
  ): Promise<RequestBoardResponseDto> {
    return this.requestBoardService.findCurrent(boardId);
  }

  @Put(":boardId")
  @ApiParam({
    name: "boardId",
    description: "요청사항 보드 ID",
    example: "main-request-board",
  })
  @ApiOperation({ summary: "공용 요청사항 보드 저장" })
  @ApiResponse({ status: 200, type: RequestBoardResponseDto })
  @ApiResponse({
    status: 409,
    description:
      "다른 사용자가 먼저 저장한 최신 보드가 있어 저장 충돌이 발생한 경우",
  })
  update(
    @Param("boardId") boardId: string,
    @Body() body: RequestBoardUpdateDto,
  ): Promise<RequestBoardResponseDto> {
    return this.requestBoardService.update(boardId, body);
  }
}
