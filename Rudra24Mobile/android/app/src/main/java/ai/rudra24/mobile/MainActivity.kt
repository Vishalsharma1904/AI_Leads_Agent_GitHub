package ai.rudra24.mobile

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.viewModels
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay

class MainActivity:ComponentActivity(){
    private val workspace:Workspace by viewModels()
    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setContent{RudraApp(workspace)};workspace.handleGoogleCallback(intent?.data);intent?.data=null}
    override fun onNewIntent(intent:Intent){super.onNewIntent(intent);setIntent(intent);workspace.handleGoogleCallback(intent.data);intent.data=null}
}
private val Green=Color(0xFF0B5148)
private val Cream=Color(0xFFFAF9EE)
private val destinations=listOf("Home","Leads","Outreach","More")
private val icons=listOf(Icons.Outlined.Home,Icons.Outlined.Search,Icons.Outlined.Send,Icons.Outlined.MoreVert)

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun RudraApp(model:Workspace=viewModel()) {
    val lifecycle=LocalLifecycleOwner.current
    LaunchedEffect(lifecycle,model.session,model.base){if(model.session!=null&&model.base.isNotBlank())lifecycle.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED){while(true){delay(8000);if(!model.busy&&model.review==null){try{model.refreshControl();model.loadJobs()}catch(_:Exception){/* Retry while foreground; API still enforces policy. */}}}}}
    MaterialTheme(colorScheme=lightColorScheme(primary=Green,background=Cream,surface=Cream,secondary=Color(0xFF657444),surfaceVariant=Color(0xFFEAEEDC))) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val tablet=maxWidth>=760.dp
            Scaffold(topBar={TopAppBar(title={Text("Rudra24",fontFamily=FontFamily.Serif)},actions={if(model.session!=null)IconButton(onClick={model.refreshAll()},enabled=!model.busy){Icon(Icons.Outlined.Refresh,"Refresh workspace")}})},
                bottomBar={if(!tablet&&model.session!=null)NavigationBar{destinations.forEachIndexed{index,title->NavigationBarItem(selected=model.page==title,onClick={model.page=title;if(title=="Outreach")model.changeChannel(model.channel)},icon={Icon(icons[index],title)},label={Text(title)})}}}) { padding->
                Row(Modifier.padding(padding).fillMaxSize()) {
                    if(tablet&&model.session!=null)NavigationRail{destinations.forEachIndexed{index,title->NavigationRailItem(selected=model.page==title,onClick={model.page=title;if(title=="Outreach")model.changeChannel(model.channel)},icon={Icon(icons[index],title)},label={Text(title)})}}
                    Column(Modifier.weight(1f).fillMaxHeight()) {
                        if(model.control?.optString("status")=="blocked")Text("Access paused. Contact the workspace owner.",Modifier.padding(14.dp))
                        if(model.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
                        if(model.error.isNotBlank())Surface(color=Color(0xFFF1EACB)){Text(model.error,Modifier.fillMaxWidth().padding(14.dp),style=MaterialTheme.typography.bodySmall)}
                        if(model.session==null)Login(model) else when(model.page){"Home"->Home(model);"Leads"->Leads(model,tablet);"Outreach"->Outreach(model,tablet);else->More(model)}
                    }
                }
            }
        }
        if(model.session!=null&&model.control?.optJSONObject("disclosure")?.optBoolean("accepted")==false) {
            AlertDialog(onDismissRequest={},title={Text("Your workspace & support")},
                text={Text("The Rudra24 owner can review your account, devices, usage, synced chats, leads, tasks and available call transcripts/recordings to manage service and support. Passwords and provider keys are not displayed. Offline work appears after sync.")},
                confirmButton={Button(onClick={model.acknowledgeDisclosure()},enabled=!model.busy){Text("I understand — continue")}},
                dismissButton={TextButton(onClick={model.logout()}){Text("Sign out")}})
        }
        model.review?.let { review->AlertDialog(onDismissRequest={model.review=null},title={Text("Review ${review.destinations.size} recipients")},text={LazyColumn(verticalArrangement=Arrangement.spacedBy(10.dp)){item{Text(review.content)};items(review.destinations){Text(it)};item{Text("Provider charges/quotas apply. Approved batches continue after closing the app.")}}},confirmButton={Button(onClick={model.submitReview()},enabled=!model.busy){Text("Confirm & submit")}},dismissButton={TextButton(onClick={model.review=null}){Text("Back")}}) }
        if(model.detail!=null)CRMDetail(model)
        model.callDetail?.let{call->AlertDialog(onDismissRequest={model.callDetail=null},title={Text("Call transcript · ${call.optString("status")}")},text={LazyColumn(verticalArrangement=Arrangement.spacedBy(10.dp)){item{Text(call.optJSONObject("analysis")?.optString("transcript_summary")?:"")};items(call.optJSONArray("transcript")?.objects()?:emptyList()){Text(it.optString("role")+": "+it.optString("message"))}}},confirmButton={TextButton(onClick={model.callDetail=null}){Text("Close")}})}
    }
}
@Composable private fun Heading(title:String,subtitle:String){Column(Modifier.padding(bottom=12.dp)){Text(title,style=MaterialTheme.typography.headlineMedium,fontFamily=FontFamily.Serif);Text(subtitle,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.secondary)}}
@Composable private fun Field(label:String,value:String,change:(String)->Unit,number:Boolean=false,multi:Boolean=false){OutlinedTextField(value=value,onValueChange=change,label={Text(label)},modifier=Modifier.fillMaxWidth(),singleLine=!multi,minLines=if(multi)4 else 1,keyboardOptions=KeyboardOptions(keyboardType=if(number)KeyboardType.Number else KeyboardType.Text))}
@Composable private fun Panel(content:@Composable ColumnScope.()->Unit){Card(Modifier.fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=Color(0xFFFFFEF6))){Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp),content=content)}}
@Composable private fun Login(model:Workspace){
    val context=LocalContext.current
    var host by remember{mutableStateOf(model.base)}
    var email by remember{mutableStateOf("")}
    var password by remember{mutableStateOf("")}
    var emailLogin by remember{mutableStateOf(false)}
    var connection by remember{mutableStateOf(false)}
    Box(Modifier.fillMaxSize(),contentAlignment=Alignment.TopCenter){
        LazyColumn(Modifier.widthIn(max=480.dp).fillMaxWidth().fillMaxHeight().imePadding().padding(horizontal=24.dp),verticalArrangement=Arrangement.spacedBy(22.dp),contentPadding=PaddingValues(top=30.dp,bottom=36.dp)){
            item{Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)){
                Text("YOUR BUSINESS, IN YOUR POCKET",style=MaterialTheme.typography.labelSmall,color=Green)
                Text("Welcome to Rudra24",style=MaterialTheme.typography.headlineLarge,fontFamily=FontFamily.Serif,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
                Text("Leads, outreach aur CRM.\nEk jagah, aapke phone par.",color=MaterialTheme.colorScheme.secondary,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
                Surface(color=MaterialTheme.colorScheme.surfaceVariant,shape=MaterialTheme.shapes.large,modifier=Modifier.padding(vertical=10.dp)){Icon(Icons.Outlined.Home,null,Modifier.padding(20.dp).size(36.dp),tint=Green)}
            }}
            item{Panel{
                Text("Let's get started",style=MaterialTheme.typography.headlineSmall,fontFamily=FontFamily.Serif)
                Text("Apna Google account choose kijiye.",color=MaterialTheme.colorScheme.secondary)
                OutlinedButton(onClick={model.googleLogin(context)},enabled=!model.busy,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp),colors=ButtonDefaults.outlinedButtonColors(containerColor=Color.White,contentColor=Color(0xFF26352E))){
                    Icon(androidx.compose.ui.res.painterResource(R.drawable.google_g),null,Modifier.size(22.dp),tint=Color.Unspecified)
                    Spacer(Modifier.width(12.dp));Text(if(model.busy)"Opening Google…" else "Continue with Google")
                }
                Text("Rudra24 password banane ki zaroorat nahi.",Modifier.fillMaxWidth(),style=MaterialTheme.typography.bodySmall,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
                HorizontalDivider()
                TextButton(onClick={emailLogin=!emailLogin},modifier=Modifier.fillMaxWidth()){Text(if(emailLogin)"Hide email sign-in" else "Use email & password")}
                if(emailLogin){
                    OutlinedTextField(email,{email=it},label={Text("Email")},keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Email),singleLine=true,modifier=Modifier.fillMaxWidth())
                    OutlinedTextField(password,{password=it},label={Text("Password")},visualTransformation=PasswordVisualTransformation(),singleLine=true,modifier=Modifier.fillMaxWidth())
                    Button(onClick={model.login(email,password);password=""},enabled=!model.busy&&email.isNotBlank()&&password.isNotBlank(),modifier=Modifier.fillMaxWidth()){Text("Sign in")}
                }
                Text("Aapke account ka data aapke workspace mein rahega.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.secondary)
            }}
            item{TextButton(onClick={connection=!connection},modifier=Modifier.fillMaxWidth()){Text(if(connection)"Hide workspace settings" else "Workspace settings")}}
            if(connection)item{Panel{
                Text("Workspace connection",style=MaterialTheme.typography.titleLarge)
                Text("Google login pehle se connected hai. Custom API ka address sirf workspace owner ke liye.")
                Field("HTTPS API address (optional)",host,{host=it})
                Button(onClick={model.saveBackend(host)},enabled=!model.busy){Text("Save & connect")}
            }}
        }
    }
}
@Composable private fun Home(model:Workspace){LazyColumn(Modifier.fillMaxSize().padding(horizontal=20.dp),verticalArrangement=Arrangement.spacedBy(18.dp),contentPadding=PaddingValues(vertical=20.dp)){
    item{Heading("Namaste, ${model.email.substringBefore('@')}","Your workspace, ready for the next opportunity.")}
    if(model.base.isBlank())item{Panel{Text("Google account connected",style=MaterialTheme.typography.titleLarge);Text("Leads aur outreach ke liye cloud API connect karni hai. Setup ke baad PC band hone par bhi phone se kaam chalega.");Button(onClick={model.page="More"}){Text("Workspace settings")}}}
    item{Card(colors=CardDefaults.cardColors(containerColor=Green)){Column(Modifier.padding(24.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){Text("Find your next client",style=MaterialTheme.typography.headlineSmall,color=Cream,fontFamily=FontFamily.Serif);Text("Discover leads. Review your next outreach batch.",color=Cream);FilledTonalButton(onClick={model.page="Leads"}){Text("Find leads")}}}}
    item{Row(horizontalArrangement=Arrangement.spacedBy(15.dp)){Text("${model.total}\nSaved leads",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);Text("${model.jobs.size}\nJobs",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)}}
    item{Text("Recent activity",style=MaterialTheme.typography.titleLarge)}
    if(model.jobs.isEmpty())item{Text("No jobs yet. Start a lead search.")}
    items(model.jobs,key={it.type+it.id}){JobCard(model,it)}
}}
@Composable private fun Search(model:Workspace){var city by remember{mutableStateOf("Noida")};var industry by remember{mutableStateOf("Hotels")};var count by remember{mutableStateOf("10")};Panel{Text("New lead search",style=MaterialTheme.typography.titleLarge);Field("City or precise area",city,{city=it});Field("Business category",industry,{industry=it});Field("Count (1–100)",count,{count=it},number=true);Button(onClick={model.search(city,industry,count)},enabled=!model.busy){Text("Start search")};Text("Apify primary, Maps fallback. Credits may be used; search continues on the backend.",style=MaterialTheme.typography.bodySmall)}}
@Composable private fun LeadCard(model:Workspace,lead:Lead){Panel{Row{Checkbox(checked=lead.id in model.selected,onCheckedChange={model.toggle(lead.id)});Column(Modifier.weight(1f)){Text(lead.company,style=MaterialTheme.typography.titleMedium);Text(lead.stage,style=MaterialTheme.typography.labelSmall);Text(lead.address,style=MaterialTheme.typography.bodySmall);Text(lead.phone.ifBlank{"No phone"},style=MaterialTheme.typography.bodySmall);Text(lead.email.ifBlank{"No email"},style=MaterialTheme.typography.bodySmall)}};TextButton(onClick={model.leadDetail(lead.id)},enabled=!model.busy){Text("Details & history")}}}
@Composable private fun Leads(model:Workspace,tablet:Boolean){var filter by remember{mutableStateOf("")};val context=LocalContext.current;val export=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")){uri->uri?.let{try{context.contentResolver.openOutputStream(it)?.use{stream->stream.write(model.csv().toByteArray())}}catch(_:Exception){model.report("Export could not be saved. Choose a writable folder and retry.")}}}
    Row(Modifier.fillMaxSize()){
        LazyColumn(Modifier.weight(1f).padding(horizontal=20.dp),verticalArrangement=Arrangement.spacedBy(16.dp),contentPadding=PaddingValues(vertical=20.dp)){
            item{Heading("Leads","${model.total} saved · ${model.selected.size} selected")}
            if(!tablet)item{Search(model)}
            item{Field("Filter saved leads",filter,{filter=it});Row{TextButton(onClick={model.action{model.loadLeads(filter=filter)}}){Text("Filter")};TextButton(onClick={export.launch("Rudra24-loaded-leads.csv")}){Text("Export CSV")}}}
            item{Button(onClick={model.page="Outreach";model.changeChannel(model.channel)}){Text("Review selected outreach")}}
            if(model.leads.isEmpty())item{Text("This account has no saved leads. Start a search or refresh.")}
            items(model.leads,key={it.id}){LeadCard(model,it)}
            if(model.leads.size<model.total)item{OutlinedButton(onClick={model.action{model.loadLeads(true,filter)}},enabled=!model.busy){Text("Load more")}}
        }
        if(tablet)Column(Modifier.width(340.dp).padding(20.dp)){Search(model)}
    }
}
@Composable private fun ChoiceField(label:String,choices:List<Choice>,selected:String,change:(Choice)->Unit){var open by remember{mutableStateOf(false)};OutlinedButton(onClick={open=true},modifier=Modifier.fillMaxWidth()){Text(choices.find{it.id+it.language==selected}?.let{it.label+if(it.language.isNotBlank())" · "+it.language else ""}?:label)};DropdownMenu(expanded=open,onDismissRequest={open=false}){if(choices.isEmpty())DropdownMenuItem(text={Text("No connected options. Refresh connections.")},onClick={open=false});choices.forEach{choice->DropdownMenuItem(text={Text(choice.label+if(choice.language.isNotBlank())" · "+choice.language else "")},onClick={change(choice);open=false})}}}
@Composable private fun OutreachForm(model:Workspace){var limit by remember{mutableStateOf("10")};var subject by remember{mutableStateOf("")};var message by remember{mutableStateOf("")};var agent by remember{mutableStateOf("")};var phone by remember{mutableStateOf("")};var template by remember{mutableStateOf<Choice?>(null)};var params by remember{mutableStateOf("")};var optIn by remember{mutableStateOf(false)}
    Panel{Text("${model.selected.size} leads selected",style=MaterialTheme.typography.titleLarge);Field("First N selected (max 200)",limit,{limit=it},number=true)
        when(model.channel){"calls"->{ChoiceField("Choose agent",model.agents,agent,{agent=it.id});ChoiceField("Outbound number",model.phones,phone,{phone=it.id})};"email"->{Field("Subject",subject,{subject=it});Field("Message",message,{message=it},multi=true)};else->{ChoiceField("Approved template",model.templates,template?.let{it.id+it.language}?:"",{template=it});template?.let{Text(it.body,style=MaterialTheme.typography.bodySmall)};Field("Body parameters (one per line)",params,{params=it},multi=true);Row{Checkbox(optIn,{optIn=it});Text("All recipients gave WhatsApp opt-in.",Modifier.padding(top=10.dp))}}}
        Button(onClick={model.prepare(limit,subject,message,agent,phone,template,params,optIn)},enabled=!model.busy){Text("Review batch")};TextButton(onClick={model.changeChannel(model.channel)},enabled=!model.busy){Text("Refresh connections")};Text("Approved batches continue after closing the app.",style=MaterialTheme.typography.bodySmall)
    }
}
@Composable private fun Outreach(model:Workspace,tablet:Boolean){Column(Modifier.fillMaxSize()){
    Row(Modifier.padding(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("calls","email","whatsapp").forEach{channel->FilterChip(selected=model.channel==channel,onClick={model.changeChannel(channel)},label={Text(channel.replaceFirstChar{it.uppercase()})})}}
    Row(Modifier.weight(1f)){
        LazyColumn(Modifier.weight(1f).padding(horizontal=20.dp),verticalArrangement=Arrangement.spacedBy(16.dp),contentPadding=PaddingValues(vertical=20.dp)){
            item{Heading("Outreach","Select leads. Review every batch.")};if(!tablet)item{OutreachForm(model)}
            item{Row{Checkbox(model.leads.isNotEmpty()&&model.leads.all{it.id in model.selected},{checked->model.selected=if(checked)model.leads.map{it.id}.toSet() else emptySet()});Text("Select visible leads",Modifier.padding(top=12.dp))}}
            items(model.leads,key={it.id}){LeadCard(model,it)}
            if(model.leads.size<model.total)item{OutlinedButton(onClick={model.action{model.loadLeads(true)}},enabled=!model.busy){Text("Load more")}}
            item{Text("Batch history",style=MaterialTheme.typography.titleLarge)};items(model.jobs.filter{it.type!="lead"},key={it.type+it.id}){JobCard(model,it)}
        }
        if(tablet)LazyColumn(Modifier.width(360.dp).padding(20.dp)){item{OutreachForm(model)}}
    }
}}
@Composable private fun JobCard(model:Workspace,job:Job){Panel{Text(job.label,style=MaterialTheme.typography.titleMedium);Text(job.status,style=MaterialTheme.typography.labelLarge,color=Green);Text(job.summary,style=MaterialTheme.typography.bodySmall);job.conversations.forEach{conversation->TextButton(onClick={model.showCall(conversation)},enabled=!model.busy){Text("Open call transcript")}};if(job.type=="call")TextButton(onClick={model.refreshJob(job)},enabled=!model.busy){Text("Refresh provider status")};if(job.status in listOf("queued","running","pending","attention"))TextButton(onClick={model.cancel(job)},enabled=!model.busy){Text("Stop remaining")}}}
@Composable private fun More(model:Workspace){var host by remember{mutableStateOf(model.base)};LazyColumn(Modifier.fillMaxSize().padding(horizontal=20.dp),verticalArrangement=Arrangement.spacedBy(18.dp),contentPadding=PaddingValues(vertical=20.dp)){
    item{Heading("More","Account, CRM and workspace")};item{Panel{Text(model.email,style=MaterialTheme.typography.titleLarge);Text("Data and personalization belong to this account.");OutlinedButton(onClick={model.logout()}){Text("Sign out")}}}
    item{Panel{Text("CRM & history",style=MaterialTheme.typography.titleLarge);Text("Open a lead to see stage, activities and follow-ups.");Button(onClick={model.page="Leads"}){Text("Open leads")};TextButton(onClick={model.page="Home"}){Text("Job history")}}}
    item{Panel{Text("Connection",style=MaterialTheme.typography.titleLarge);TextButton(onClick={model.checkProviders()},enabled=!model.busy){Text("Check connected providers")};if(model.providerStatus.isNotBlank())Text(model.providerStatus);Field("HTTPS backend URL",host,{host=it});Button(onClick={model.saveBackend(host)},enabled=!model.busy){Text("Save & reconnect")};Text("Changing backend signs you out. Cloud API aur provider setup workspace owner manage karega.",style=MaterialTheme.typography.bodySmall)}}
}}
