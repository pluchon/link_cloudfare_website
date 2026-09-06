# Windows解决使用codex或其他AI-IDE时powershell语法打架问题

> 相信各位这段时间使用codex或者是claudecode的时候，经常会碰到AI执行代码，总是要先处理powershell的转义问题

***

![1758766224464](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260906102822292.jpg)

***

> tags: [codex, powershell, 转义问题, 更好的使用AI工具]

其实这个问题不复杂，本质上就是一句话：Windows 原生的powershell5太旧了，语法多处不兼容，而AI默认执行powershell是使用powershell7语法的  

叠个甲：平替方案可以使用`git bash`或者`wsl` ，这里主要是讲解使用powershell解决方案  

## 第一步：让AI不再使用原生powershell

打开Windows应用商店搜`powershell` ，注意看版本号是不是7以上  

![image-20260906102507711](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260906102507763.png)

如果没问题，点击下载安装

## 第二步：修改powershell默认的启动方式

> 如果下载了没有指定默认启动，则是不会生效的

打开你的Windows的搜索框，搜索powershell后，打开powershell终端，右侧有一个"V"的下拉菜单，点击设置，选择启动菜单栏，第一个预设定的启动终端，选择我们刚刚安装的powershell

![image-20260906102543079](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260906102543120.png)

## 第三步：给AI-IDE加入提示词

我已经把提示词放到了下方，大家直接粘贴，这里以codex（ChatGPT）和Claude为例

```markdown
# 开发约束规范

> 用途：项目通用工程规范，开发/排障/发布任务默认遵循。用户当前对话中的具体指令优先级高于本文件；未覆盖场景按"范围纪律"停下确认，不自行猜测。标签含义：【必须】强制、【禁止】绝不可做、【建议】默认如此但可按上下文调整、【规则】具体做法、【原则】判断依据。

---

## Windows 约束

当前环境：Windows 11 / pwsh 7。

- 【禁止】非 Linux shell 默认用 Bash 语法；不用 Bash 引号/转义习惯，复杂正则单引号包裹，同时含单双引号时拆成多条简单 `rg`
- 【必须】多行 Python 用 here-string 而非 Bash heredoc：`@'...'@ | python -`；`git commit` 消息同样用 here-string，禁止 `-m "$(cat <<'EOF' ...)"`
- 【规则】`foreach`/`if` 等语句块先 `$()`/`@()` 包裹或赋值给变量再进管道
- 【禁止】把含 `*` 的通配目录直接传给 `rg`；先用 `Get-ChildItem` 展开为真实路径
- 【坑点】裸 `bash` 可能解析到无 Docker 的 WSL `bash.exe`，需要 Git Bash 时写完整路径 `C:\Program Files\Git\bin\bash.exe`；新建的 `.sh`/`.py` 默认 CRLF，在 Linux/Git Bash 执行会报 `$'\r'` 相关错误，生成后先转 LF；编辑既有脚本保持原行尾一致，`bash -n` 校验前先复制成 LF 版本

---
```

codex（ChatGPT）粘贴的位置如下

![image-20260906102623898](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260906102623936.png)

Claude工作区粘贴的位置如下（一般Claude使用的是Git bash，但是这里为了方便也可以粘贴）

![image-20260906102648960](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260906102648997.png)

## 第四步：测试效果

> 尝试在一个新的对话里输入，让它看看默认执行的powershell是什么版本

![image-20260906102719080](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260906102719137.png)

## 写在最后

其实这里的个性化的内容区不只是可以存规范，还可以把你的代码风格以及通用的项目规范放进去

当然最好还是变成自己的skills

> 感谢大家的阅读，希望能够帮助到大家，如果大家有更好的方法，欢迎留言