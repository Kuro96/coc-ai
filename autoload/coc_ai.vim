let s:role_list = []

function! s:GetSelectionOrRange(is_selection, is_range, ...)
  if a:is_selection
    return s:GetVisualSelection()
  elseif a:is_range
    return trim(join(getline(a:1, a:2), "\n"))
  else
    return ""
  endif
endfunction

function! s:SelectSelectionOrRange(is_selection, ...)
  if a:is_selection
    execute "normal! gv"
  else
    execute 'normal!' . a:1 . 'GV' . a:2 . 'G'
  endif
endfunction

function! s:GetVisualSelection()
  let [line_start, column_start] = getpos("'<")[1:2]
  let [line_end, column_end] = getpos("'>")[1:2]
  let lines = getline(line_start, line_end)
  if len(lines) == 0
    return ''
  endif
  " The exclusive mode means that the last character of the selection area is not included in the operation scope.
  let lines[-1] = lines[-1][: column_end - (&selection == 'inclusive' ? 1 : 2)]
  let lines[0] = lines[0][column_start - 1:]
  return join(lines, "\n")
endfunction

" - uses_range   - true if range passed
" - a:1          - optional instruction prompt
function! coc_ai#AIRun(uses_range, ...) range abort
  let l:instruction = a:0 > 0 ? a:1 : ""
  let l:is_selection = a:uses_range && a:firstline == line("'<") && a:lastline == line("'>")
  let l:selection = s:GetSelectionOrRange(l:is_selection, a:uses_range, a:firstline, a:lastline)

  let l:cursor_on_empty_line = empty(getline('.'))
  if l:cursor_on_empty_line
    execute "normal! " . a:lastline . "GA"
  else
    execute "normal! " . a:lastline . "Go"
  endif
  call CocActionAsync('runCommand', 'coc-ai.complete', l:selection, l:instruction)
endfunction

" - uses_range   - true if range passed
" - a:1          - optional instruction prompt
function! coc_ai#AIEditRun(uses_range, ...) range abort
  let l:instruction = a:0 > 0 ? a:1 : ""
  let l:is_selection = a:uses_range && a:firstline == line("'<") && a:lastline == line("'>")
  let l:selection = s:GetSelectionOrRange(l:is_selection, a:uses_range, a:firstline, a:lastline)

  let l:range = {'kind': l:is_selection ? 'visual' : 'line'}
  if l:is_selection
    let l:range.start = getpos("'<")[1:2]
    let l:range.end = getpos("'>")[1:2]
  else
    let l:range.start = [a:firstline, 0]
    let l:range.end = [a:lastline, 0]
  endif

  call CocActionAsync('runCommand', 'coc-ai.edit', l:selection, l:instruction, l:range)
endfunction

" Start and answer the chat
" - uses_range   - true if range passed
" - a:1          - optional instruction prompt
function! coc_ai#AIChatRun(uses_range, ...) range abort
  let l:instruction = a:0 > 0 ? a:1 : ""
  let l:is_selection = a:uses_range && a:firstline == line("'<") && a:lastline == line("'>")
  let l:selection = s:GetSelectionOrRange(l:is_selection, a:uses_range, a:firstline, a:lastline)

  call CocActionAsync('runCommand', 'coc-ai.chat', l:selection, l:instruction)
endfunction

function! coc_ai#AINewChatRun(uses_range, ...) range abort
  let l:instruction = a:0 > 0 ? a:1 : ""
  let l:is_selection = a:uses_range && a:firstline == line("'<") && a:lastline == line("'>")
  let l:selection = s:GetSelectionOrRange(l:is_selection, a:uses_range, a:firstline, a:lastline)

  call CocActionAsync('runCommand', 'coc-ai.newChat', l:selection, l:instruction)
endfunction

"TODO Repeat last AI command
function! coc_ai#AIRedoRun() abort
  undo
  if s:last_command ==# "complete"
    exe s:last_firstline.",".s:last_lastline . "call coc_ai#AIRun(s:last_config, s:last_instruction, s:last_is_selection)"
  elseif s:last_command ==# "edit"
    exe s:last_firstline.",".s:last_lastline . "call coc_ai#AIEditRun(s:last_config, s:last_instruction, s:last_is_selection)"
  elseif s:last_command ==# "chat"
    " chat does not need prompt, all information are in the buffer already
    call coc_ai#AIChatRun(0, s:last_config)
  endif
endfunction

function! coc_ai#RoleCompletion(A,L,P) abort
  if empty(s:role_list)
    let s:role_list = CocAction('runCommand', 'coc-ai.roleComplete')
    call map(s:role_list, '"/" . v:val')
  endif
  let l:role_list = s:role_list
  return filter(l:role_list, 'v:val =~ "^' . a:A . '"')
endfunction
