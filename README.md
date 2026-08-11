项目名称：途小灵
这是一个给用户用的旅行助手。
用户只要输入想去哪个城市，程序会先查这个城市最近几天的天气，同时联网搜索当地有什么好吃的、好玩的景点，给用户推荐路线，顺便也提供一下这个城市的住宿情况。
技术方面，后台是用 LangChain 做的，数据存到 sqlite 里，这样能记住用户的偏好，每次聊的时候能想起来以前聊过什么。然后整个服务用 FastAPI 包了一层接口，方便和前端对接，在本地跑起来就能用。另外它支持发文字和发图片两种输入方式。
该项目里面默认使用的LLM是阿里云平台的"qwen3.7-flash",您可以根据个人需求自行更改
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------Project Name: Tu Xiaoling
This is a travel assistant designed for users.
As long as the user inputs which city they want to go to, the program will first check the weather of this city in the past few days, and at the same time search online for local delicious and fun attractions, recommend routes to the user, and also provide accommodation information for this city.
In terms of technology, the backend is built using LangChain and data is stored in SQLite, which can remember users' preferences and recall what they have talked about before every time they chat. Then the entire service was packaged with a layer of interface using FastAPI, making it easy to interface with the front-end and run locally. In addition, it supports two input methods: sending text and sending pictures.
The default LLM used in this project is "qwen3.7-flash" from Alibaba Cloud platform. You can change it according to your personal needs

