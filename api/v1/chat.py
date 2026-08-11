from fastapi import APIRouter
from starlette.responses import StreamingResponse
from tuxiaoling.models.schemas import ChatRequest
from tuxiaoling.agents.txl import city_search, clear_session, get_messages
router = APIRouter()

@router.post("/chat/stream")
async def chat_endpoint(request:ChatRequest):
    """流式对话"""
    return StreamingResponse(
       city_search(request.message,request.image_url,request.thread_id),
        media_type="text/event-stream",
    )

@router.get("/chat/messages")
async def get_chat_messages(thread_id: str):
    """获取历史消息"""
    messages = get_messages(thread_id)
    return {"messages": messages}


@router.delete("/chat/messages")
async def clear_chat_messages(thread_id: str):
    """清空会话信息"""
    clear_session(thread_id)
    return {"success": True}