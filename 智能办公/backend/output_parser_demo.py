"""LangChain Model I/O 与三种 Output Parser 的可运行演示。

默认使用 FakeListChatModel，离线即可展示完整链式调用效果；传入 --real 后改用
与 OpenAI 接口兼容的真实模型配置（DEEPSEEK_API_KEY/BASE_URL/MODEL）。
"""

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.output_parsers import (
    CommaSeparatedListOutputParser,
    JsonOutputParser,
    XMLOutputParser,
)
from langchain_core.prompts import ChatPromptTemplate


SUPPORTED_FORMATS = ("json", "list", "xml")
DEMO_RESPONSES = {
    "json": '{"conclusion":"本周应优先完成排班审核。","suggestions":["核对待审核班表","检查班次冲突"],"risks":["夜班后休息时间需人工确认"]}',
    "list": "本周应优先完成排班审核,核对待审核班表,检查班次冲突,夜班后休息时间需人工确认",
    "xml": "<response><conclusion>本周应优先完成排班审核。</conclusion><suggestions><item>核对待审核班表</item><item>检查班次冲突</item></suggestions><risks><item>夜班后休息时间需人工确认</item></risks></response>",
}


def configure_console_encoding():
    """Windows 终端默认编码不一致时，保证中文演示结果可读。"""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


def create_output_parser(output_format):
    """创建 JSON、逗号列表或安全 XML 解析器。"""
    parsers = {
        "json": JsonOutputParser(),
        "list": CommaSeparatedListOutputParser(),
        "xml": XMLOutputParser(parser="defusedxml"),
    }
    if output_format not in parsers:
        raise ValueError(f"不支持的格式：{output_format}")
    return parsers[output_format]


def create_prompt_template(parser):
    """构建带解析器格式指令的消息提示词模板。"""
    return ChatPromptTemplate.from_messages([
        ("system", "你是员工排班与人事管理助手。回答必须简洁、可靠，不执行任何写操作。"),
        ("human", "用户问题：{question}\n\n输出格式要求：\n{format_instructions}"),
    ]).partial(format_instructions=parser.get_format_instructions())


def create_model(output_format, use_real_model=False):
    """创建离线演示模型，或创建与 OpenAI 接口兼容的真实对话模型。"""
    if not use_real_model:
        return FakeListChatModel(responses=[DEMO_RESPONSES[output_format]])

    load_dotenv(Path(__file__).with_name(".env"))
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    base_url = os.getenv("DEEPSEEK_BASE_URL", "").strip()
    model_name = os.getenv("MODEL", "").strip()
    if not (api_key and base_url and model_name):
        raise RuntimeError("真实模型模式需要配置 DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL 和 MODEL")

    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=model_name,
        api_key=api_key,
        base_url=base_url,
        temperature=0.2,
        max_tokens=600,
        timeout=30,
        max_retries=1,
    )


def run_parser_chain(output_format, question, use_real_model=False):
    """执行 LCEL：提示词模板 | 模型 | 输出解析器。"""
    parser = create_output_parser(output_format)
    prompt = create_prompt_template(parser)
    model = create_model(output_format, use_real_model)
    chain = prompt | model | parser
    return chain.invoke({"question": question})


def render_result(output_format, result):
    """将解析后的 Python 对象格式化为便于课堂展示的文本。"""
    parser_names = {
        "json": "JsonOutputParser",
        "list": "CommaSeparatedListOutputParser",
        "xml": "XMLOutputParser",
    }
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    return f"[{output_format.upper()} / {parser_names[output_format]}]\nPython 类型：{type(result).__name__}\n解析结果：\n{rendered}"


def main():
    configure_console_encoding()
    parser = argparse.ArgumentParser(description="演示三种 LangChain Output Parser")
    parser.add_argument("--format", choices=("all", *SUPPORTED_FORMATS), default="all", help="要演示的解析格式")
    parser.add_argument("--question", default="我本周应该优先处理什么？", help="提交给模型的问题")
    parser.add_argument("--real", action="store_true", help="使用 .env 中配置的真实模型")
    args = parser.parse_args()

    selected = SUPPORTED_FORMATS if args.format == "all" else (args.format,)
    print("链式调用：ChatPromptTemplate | ChatModel | OutputParser")
    print(f"模型模式：{'真实模型' if args.real else '离线 FakeListChatModel'}")
    print(f"问题：{args.question}")
    for output_format in selected:
        result = run_parser_chain(output_format, args.question, args.real)
        print("\n" + render_result(output_format, result))


if __name__ == "__main__":
    main()
