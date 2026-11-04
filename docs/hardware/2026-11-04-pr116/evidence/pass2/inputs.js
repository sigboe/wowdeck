[...document.querySelectorAll('input')].map(e=>({value:e.value,placeholder:e.placeholder,visible:!!e.getBoundingClientRect().width}))
