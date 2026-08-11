import json
import requests

def get_weather(location:str):
    # 文档规定完整接口地址，不可修改
    api_url = "https://uapis.cn/api/v1/misc/weather"

    # 鉴权请求头，替换成你自己的uapi密钥
    headers = {
        "Authorization": "Bearer uapi-vvw0s1eymzVgGN29ynYr1BBlUtYgJ2pg8OgE7F-Z"
    }

    # 请求参数，按需修改
    params = {
        # 定位方式三选一，其余注释掉
        # "adcode": "110000",    # 北京行政区编码（优先级最高）
        "city": location,          # 按城市名查询，支持中文/英文如 Tokyo
        # 不传 city、adcode 则自动根据IP定位

        "lang": "zh",            # 返回语言 zh中文 / en英文
        "extended": "true",      # 开启扩展气象数据（体感、空气质量等）
        "forecast": "true",      # 开启7天逐日预报
        "hourly": "true",        # 开启24小时逐小时预报
        "minutely": "true",      # 分钟级降水，仅国内城市生效
        "indices": "true"        # 18项生活指数
    }

    try:
        # 发送GET请求
        response = requests.get(url=api_url, headers=headers, params=params, timeout=10)
        # 打印状态码方便排错
        print(f"请求状态码：{response.status_code}")
        # 解析返回json数据
        result = response.json()

        # 简单提取核心实时天气示例
        if response.status_code == 200:
            return json.dumps(result, ensure_ascii=False, indent=2)
        return json.dumps({"error": result}, ensure_ascii=False)

    except requests.exceptions.Timeout:
        print("请求超时，请检查网络")
    except Exception as e:
        print(f"请求异常：{str(e)}")


if __name__ == "__main__":
    get_weather("南阳")