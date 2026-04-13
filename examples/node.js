(async () => {
  const res = await fetch('http://localhost:3000/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'user',
          content: '你是什么模型？哪个版本？数据截止时间？',
        },
      ],
      stream: true,
    }),
  })

  const decoder = new TextDecoder()
  for await (const chunk of res.body) {
    const text = decoder.decode(chunk)
    console.log(text)
  }
})()
