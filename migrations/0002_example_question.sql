INSERT OR IGNORE INTO questions (
  id, source_id, type, question, options_json, answer_json, explanation, category, is_core, reference_url
) VALUES (
  'source-460',
  460,
  'single',
  '通过LlamaIndex创建RAG应用时，编写了如下代码，这段代码中，如何修改召回文本段的个数？
print("正在创建索引...")
index = VectorStoreIndex.from_documents([document])
print("正在创建提问引擎...")
query_engine = index.as_query_engine(streaming=True)
print("正在生成回复...")
streaming_response = query_engine.query("需求分析使用的工具是什么？")
print("回答是：\n")
streaming_response.print_response_stream()',
  '{"A":"from_documents[similarity_top_k]","B":"as_query_engine(similarity_top_k)","C":"query_engine.query(similarity_top_k)","D":"streaming_response.print_response_stream(similarity_top_k)"}',
  '["B"]',
  '召回文本段个数通过 as_query_engine(similarity_top_k=n) 设置；from_documents 用于建索引，query() 发起提问，print_response_stream 负责流式打印。',
  'RAG与检索增强',
  1,
  'https://github.com/AlibabaCloudDocs/aliyun_acp_learning/blob/main/大模型ACP认证教程/C2_构造问答系统/2_2_扩展答疑机器人的知识范围.ipynb'
);
