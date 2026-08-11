# 导入环境
import os
import sys
from langchain_core.messages import HumanMessage, AIMessage
from tuxiaoling.common.logger import logger
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))) # 把文件本身目录加进sys.path,以使get_weather函数被正常调用
import sqlite3
from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain.chat_models import init_chat_model
from langchain_core.tools import tool
from langchain_tavily import TavilySearch
from langgraph.checkpoint.sqlite import SqliteSaver
from tuxiaoling.agents.get_weather import get_weather as fetch_weather
load_dotenv()

# 定义工具
@tool
def get_weather(location:str):
    """查询指定城市的实时天气和未来预报，返回JSON字符串"""
    return fetch_weather(location)

# 定义tavily检索工具(减少token消耗)
tavily = TavilySearch(
    max_results=5,
    topic="general",
    tavily_api_key=os.getenv("TAVILY_API_KEY"),
    include_images=True # 这里是打开搜索引擎展示照片的代码
)
@tool
def web_find(query:str):
    """联网搜索旅行信息（美食/景点/住宿等），返回结果 JSON 中包含真实图片链接 images 字段"""
    return tavily.invoke(query)

# 初始化checkpoint(使用sqlite数据库)

# 连接sqlite
# 数据库路径改为基于文件位置的绝对路径，避免启动目录不同导致找不到 db 目录
_db_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "db")
os.makedirs(_db_dir, exist_ok=True)
connection = sqlite3.connect(os.path.join(_db_dir, "checkpoint.db"), check_same_thread=False)
# 初始化checkpoint
checkpointer = SqliteSaver(connection)
# 自动建表
checkpointer.setup()


# -----------------------------------初始化智能体--------------------------------------------

# 创建系统提示词
system_prompt = """
你是一名专业的AI旅行规划师"途小灵"。收到用户输入的旅行城市后，请按以下流程操作：
1.查询目的地天气：调用 get_weather 工具获取该城市近3-5天的天气预报（温度、天气状况、降水、风力等）。
2.并行搜索旅行信息：调用 web_find 工具，以"城市名+美食/景区/住宿"为关键词，并行搜索三类信息。搜索工具返回的 JSON 里带有 images 字段（真实图片链接），你必须从中挑选与推荐内容匹配的图片，每项推荐必须配图。
3.多维度评估与排序：从美食特色、景区可玩性、住宿便利性、天气适配度等维度对候选内容进行综合评估，筛选出最值得推荐的选项。
4.结构化方案输出：将天气、美食、景区、住宿整理为一份结构清晰的旅行攻略报告，包含天气表、推荐理由、参考图片，帮助用户快速做出决策
5.输出要求: 除了满足要求4以外,你必须先甄别用户的实际问题,如果用户没有让你做旅行指南,你就先与用户正常聊天,满足其需求!
请严格按照流程，优先调用 web_find 与get_weather工具搜索信息，搜索不到的情况下才能自己发挥。

图片输出规范：图片一律用 Markdown 语法 ![简短描述](图片URL) 输出；只能使用 http/https 开头、来自搜索结果 images 字段的真实图片链接；如果某类推荐没有可用图片，就写"（暂无图片）"，绝对不要编造或拼凑图片链接。
"""

# 初始化模型
model = init_chat_model(
    model = "qwen3.7-flash",# 这里可改用自己的多模态模型(模型必须具备图片识别功能)
    model_provider = "openai",
    base_url = os.getenv("DASHSCOPE_BASE_URL"),# 这里是相对应模型的url
    api_key = os.getenv("DASHSCOPE_API_KEY")# 这里是相对应模型的API_KEY
)

# 创建智能体
agent = create_agent(
    model = model,
    tools = [get_weather,web_find],
    checkpointer = checkpointer,
    system_prompt = system_prompt,
)

# ------------------------接口函数功能实现---------------------------
# 1 . 流式调用
async def city_search(prompt:str,image:str,thread_id:str):
    logger.info(f"[用户]:{prompt},image:{image},thread_id:{thread_id}")  # 记录日志
    try:
        # 判断是否有图片,封装不同的用户消息
        if not image or image.strip() == "":
            message = HumanMessage(content = prompt)
        else:
            message = HumanMessage(content=[
                {"type": "image","url":image},
                {"type": "text","text":prompt}
            ])
        # AI流式回复
        for token,metadata in agent.stream(
                {"messages":[message]},
                {"configurable":{"thread_id":thread_id}},
                        stream_mode = "messages"):
                if isinstance(token,AIMessage) and token.content:
                    yield token.content
    except Exception as err:
        logger.error(f"智能体调用异常: {err}")
        yield f"信息检索失败，请稍后重试（{type(err).__name__}: {err}）"

# 2. 查询会话历史
def get_messages(thread_id:str):
    """查询会话历史"""
    logger.info(f"获取会话历史,thread_id:{thread_id}")
    # 根据thread_id获取会话列表
    checkpoint = checkpointer.get({"configurable":{"thread_id":thread_id}})

    # 如果不存在,返回空列表
    if not checkpoint:
        return []

    # 安全获取messages
    channel_values = checkpoint.get("channel_values")
    if not channel_values:
        return []
    messages = channel_values.get("messages",[])
    if not messages:
        return []

    # 转换消息格式
    result = []
    for message in messages:
        if isinstance(message,HumanMessage):
            result.append(HumanMessage(content=[{"type": "text","text":message.content}]))
        elif isinstance(message,AIMessage):
            result.append(AIMessage(content=[{"type": "text","text":message.content}]))
    return result

# 3. 清空会话历史
def clear_session(thread_id:str):
    """清空会话"""
    logger.info(f"会话{thread_id}已被成功清除!")
    checkpointer.delete_thread(thread_id=thread_id)
    print("会话已经清空!")
